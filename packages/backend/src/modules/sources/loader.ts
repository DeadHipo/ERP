import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ConflictError, ValidationError } from '../../shared/errors';
import { newId } from '../../shared/identifiers';
import { openReportStream, sha256File } from '../../shared/files';
import { Decimal } from '../../shared/money';
import {
  indexHeader,
  parseBelieveFileName,
  parseBelieveRecord,
  type BelieveRecord,
  type ColumnIndex,
} from './believe-format';
import type { BelieveColumnar } from './columnar';
import { parseCsv } from './csv';
import type { SourceFileRecord, SourceFilesRegistry } from './registry';

const BATCH_ROWS = 50_000;

export interface LoadInput {
  /** The uploaded file on disk (a temporary copy is fine): .csv or .csv.zip. */
  path: string;
  /** Its original name: <reportId>_<account>_<from>_<to>.csv[.zip]. The account and the month are read from it. */
  fileName: string;
  uploadedBy?: string;
}

export interface BelieveLoaderDeps {
  registry: SourceFilesRegistry;
  columnar: BelieveColumnar;
  /** Original files are kept here as <sha256>-<name>. */
  storageDir: string;
  batchRows?: number;
}

/**
 * Loads one Believe report into ClickHouse and records it in the PostgreSQL registry:
 *
 *  1. sha256, then the checks for a second file on the same account and month or the same file again (409);
 *  2. a `loading` row in the registry (its unique indexes decide a race between two uploads);
 *  3. the file is read as a stream, every line is checked and written, unchanged and not summed, into a stage table;
 *     the loader adds up lines, gross and net with decimal.js while it reads;
 *  4. the stage table must hold exactly those numbers, and only one reporting month, the one in the file name;
 *  5. ATTACH PARTITION moves the file into believe.rows in one step; the registry row becomes `loaded` with the totals.
 *
 * Any failure removes the stage table (and the partition if it was already attached) and marks the row `failed`.
 * Equal keys are not merged here: the ClickHouse views sum them (06, decision 11).
 */
export function createBelieveLoader(deps: BelieveLoaderDeps) {
  const { registry, columnar, storageDir } = deps;
  const batchRows = deps.batchRows ?? BATCH_ROWS;

  // One load at a time per process. Two processes are separated by the registry's unique indexes.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function load(input: LoadInput): Promise<SourceFileRecord> {
    const meta = parseBelieveFileName(input.fileName);

    const sameScope = await registry.activeByScope('believe', meta.account, meta.reportingMonth);
    if (sameScope) {
      throw new ConflictError(
        `A Believe report for account ${meta.account}, month ${meta.reportingMonth} is already loaded (${sameScope.fileName}, sha256 ${sameScope.sha256.slice(0, 12)}…). A second file for the same period is not accepted.`,
        'duplicate_period',
        { existingFileId: sameScope.id },
      );
    }
    const sha256 = await sha256File(input.path);
    const sameFile = await registry.activeBySha(sha256);
    if (sameFile) {
      throw new ConflictError(`This file was already loaded as ${sameFile.fileName}`, 'duplicate_file', {
        existingFileId: sameFile.id,
      });
    }

    await mkdir(storageDir, { recursive: true });
    const storedPath = join(storageDir, `${sha256}-${input.fileName.replace(/[^\w.() -]/g, '_')}`);
    await copyFile(input.path, storedPath);

    const id = newId();
    await registry.insertLoading({
      id,
      source: 'believe',
      account: meta.account,
      reportingMonth: meta.reportingMonth,
      reportId: meta.reportId,
      fileName: input.fileName,
      storedPath,
      sha256,
      uploadedBy: input.uploadedBy ?? 'operator',
    });

    let attached = false;
    let stream: { destroy(): unknown } | undefined;
    try {
      await columnar.createStage(id);
      const opened = await openReportStream(input.path, input.fileName);
      stream = opened.stream;

      let header: string[] | undefined;
      let idx: ColumnIndex | undefined;
      let batch: Record<string, string>[] = [];
      let pending: Promise<void> = Promise.resolve();
      let lines = 0;
      let gross = new Decimal(0);
      let net = new Decimal(0);

      const flush = async () => {
        const rows = batch;
        batch = [];
        await pending; // at most one insert in flight while the next batch is being read
        const p = columnar.insertRows(id, rows);
        p.catch(() => undefined); // a failure is raised by the next `await pending`, not as an unhandled rejection
        pending = p;
      };

      for await (const row of parseCsv(opened.stream, ';')) {
        if (!header) {
          header = row;
          idx = indexHeader(row);
          continue;
        }
        lines++;
        const rec: BelieveRecord = parseBelieveRecord(row, idx as ColumnIndex, header.length, lines + 1);
        if (rec.reporting_month.slice(0, 7) !== meta.reportingMonth) {
          throw new ValidationError(
            `Line ${lines + 1}: Reporting month ${rec.reporting_month.slice(0, 7)} differs from the file month ${meta.reportingMonth}`,
          );
        }
        if (!rec.client_payment_currency) rec.client_payment_currency = 'USD'; // an empty currency is USD
        if (rec.client_payment_currency !== 'USD')
          throw new ValidationError(
            `Line ${lines + 1}: currency ${rec.client_payment_currency}; only USD is accepted`,
          );
        gross = gross.plus(rec.gross_revenue);
        net = net.plus(rec.net_revenue);
        batch.push({ file_id: id, ...rec });
        if (batch.length >= batchRows) await flush();
      }
      if (!header) throw new ValidationError('The report is empty');
      if (lines === 0) throw new ValidationError('The report has a header but no lines');
      if (batch.length) await flush();
      await pending;

      // The stage table must hold exactly what was read: nothing lost, nothing added, nothing rounded.
      const t = await columnar.stageTotals(id);
      if (
        t.lines !== String(lines) ||
        !new Decimal(t.gross).equals(gross) ||
        !new Decimal(t.net).equals(net)
      ) {
        throw new ValidationError(
          `Control check failed: read ${lines} lines, gross ${gross.toFixed()}, net ${net.toFixed()}; stored ${t.lines} lines, gross ${t.gross}, net ${t.net}`,
        );
      }
      if (t.months.length !== 1 || t.months[0] !== meta.reportingMonth)
        throw new ValidationError(`Control check failed: reporting months ${t.months.join(', ')}`);

      await columnar.attach(id, meta.reportingMonth);
      attached = true;
      await columnar.dropStage(id);
      return await registry.markLoaded(id, {
        lineCount: lines,
        netTotal: net.toFixed(),
        grossTotal: gross.toFixed(),
      });
    } catch (e) {
      stream?.destroy();
      // Cleanup never hides the original error.
      const quiet = (p: Promise<unknown>) =>
        p.catch((err: Error) => console.error(`sources loader cleanup: ${err.message}`));
      if (attached) await quiet(columnar.dropPartition(id, meta.reportingMonth));
      await quiet(columnar.dropStage(id));
      await quiet(registry.markFailed(id));
      throw e;
    }
  }

  return {
    ingestBelieve: (input: LoadInput): Promise<SourceFileRecord> => serial(() => load(input)),
  };
}

export type BelieveLoader = ReturnType<typeof createBelieveLoader>;
