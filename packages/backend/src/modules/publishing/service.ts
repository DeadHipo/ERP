import { constants as fsConstants } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../../shared/errors';
import { newId, normalizeName } from '../../shared/identifiers';
import { assertDate, normalizeTimestamp, nowIso } from '../../shared/dates';
import { Decimal, picoToString } from '../../shared/money';
import { sha256File } from '../../shared/files';
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createPublishingRepository } from './repository';
import type { AggregatedLine, StatementRow, TermsRow, WriterInsert, WriterRow } from './repository';
import { parseSongwriters, quartersFromFileName, readB17Statement, type B17Line } from './b17-format';

export interface StatementView {
  id: string;
  source: string;
  periods: string[];
  fileName: string;
  sha256: string;
  generatedAt: string;
  generatedAtSource: string;
  uploadedAt: string;
  status: string;
  lineCount: number;
  totalPayable: string;
  warnings: string[];
  /** The own label the statement was loaded under (D-169): opaque text, the facade checks it; null = before the labels. */
  labelId: string | null;
}

const view = (s: StatementRow): StatementView => ({
  id: s.id,
  source: s.source,
  periods: JSON.parse(s.periods) as string[],
  fileName: s.fileName,
  sha256: s.sha256,
  generatedAt: s.generatedAt,
  generatedAtSource: s.generatedAtSource,
  uploadedAt: s.uploadedAt,
  status: s.status,
  lineCount: s.lineCount,
  totalPayable: s.totalPayable,
  warnings: JSON.parse(s.warnings) as string[],
  labelId: s.labelId ?? null,
});

/** A unique violation of PostgreSQL (sha256 or the quarter of a statement, taken by a concurrent load). */
const isUniqueViolation = (e: unknown) =>
  (e as { code?: string }).code === '23505' || /UNIQUE/.test((e as Error).message);

export function createPublishingService(db: Db, org: OrgScope, storageDir: string) {
  const repo = createPublishingRepository(db, org);
  const tx = <T>(fn: () => Promise<T>): Promise<T> => repo.transaction(fn);

  const periodTaken = repo.periodTaken;

  // One statement load at a time: the duplicate checks and the kept original must not race.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  }

  const head = {
    /**
     * Loads a B17 quarterly statement (xlsx, streaming reader). A second statement for an already loaded quarter
     * is rejected, as for Believe. New writer names are registered as unmapped writers for the facade to resolve.
     */
    ingestB17(input: {
      path: string;
      fileName: string;
      generatedAt?: string | null;
      /** The own label of the statement (D-169), stored as is. */
      labelId?: string | null;
    }): Promise<StatementView> {
      return serial(() => load(input));
    },
  };

  async function load(input: {
    path: string;
    fileName: string;
    generatedAt?: string | null;
    labelId?: string | null;
  }): Promise<StatementView> {
    {
      if (!/\.xlsx$/i.test(input.fileName)) throw new ValidationError('B17 statements are accepted as .xlsx');
      for (const q of quartersFromFileName(input.fileName)) {
        const taken = await periodTaken(q);
        if (taken) {
          throw new ConflictError(
            `A B17 statement for ${q} is already loaded. A second file for the same period is not accepted.`,
            'duplicate_period',
            {
              existingStatementId: taken.statementId,
            },
          );
        }
      }
      const sha256 = await sha256File(input.path);
      const same = await repo.statementBySha(sha256);
      if (same) throw new ConflictError(`This file was already loaded as ${same.fileName}`, 'duplicate_file');
      const providedGeneratedAt = input.generatedAt ? normalizeTimestamp(input.generatedAt) : null;
      await mkdir(storageDir, { recursive: true });
      const storedPath = join(storageDir, `${sha256}-${input.fileName.replace(/[^\w.() -]/g, '_')}`);
      // Never overwrite or delete an original kept for another statement.
      let created = false;
      try {
        await copyFile(input.path, storedPath, fsConstants.COPYFILE_EXCL);
        created = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }

      const id = newId();
      const now = nowIso();
      const lines: B17Line[] = [];
      try {
        for await (const l of readB17Statement(input.path, input.fileName)) lines.push(l);
        if (lines.length === 0) throw new ValidationError('The statement has no lines');
        const periods = [...new Set(lines.map((l) => l.period))].sort();
        await tx(async () => {
          for (const p of periods) {
            const taken = await periodTaken(p);
            if (taken)
              throw new ConflictError(`A B17 statement for ${p} is already loaded`, 'duplicate_period', {
                existingStatementId: taken.statementId,
              });
          }
          await repo.insertStatement({
            id,
            source: 'b17',
            periods: JSON.stringify(periods),
            fileName: input.fileName,
            storedPath,
            sha256,
            generatedAt: providedGeneratedAt ?? now,
            generatedAtSource: providedGeneratedAt ? 'provided' : 'upload_time',
            uploadedAt: now,
            status: 'loaded',
            lineCount: lines.length,
            totalPayable: '0',
            warnings: '[]',
            labelId: input.labelId ?? null,
          });
          for (const p of periods) await repo.insertStatementPeriod(p, id);
          let total = 0n;
          // The writers of the load are worked out in memory, in line order, and written set-based afterwards.
          // The result is the same as registering them line by line: a new name is inserted with the display name and
          // role of its first appearance, a songwriter that also appears as a holder ends as holder, and existing
          // rows are only upgraded (songwriter -> holder) and retried (external -> unmapped) for the holders.
          const newWriters = new Map<string, WriterInsert>();
          const holders = new Set<string>();
          const seenSongwriters = new Set<string>();
          const rows = lines.map((l) => {
            const norm = normalizeName(l.writerName);
            total += l.payablePico;
            const known = newWriters.get(norm);
            if (known) known.role = 'holder';
            else newWriters.set(norm, { writerNorm: norm, displayName: l.writerName, role: 'holder' });
            holders.add(norm);
            for (const name of parseSongwriters(l.songwriters)) {
              if (seenSongwriters.has(name)) continue;
              seenSongwriters.add(name);
              const sn = normalizeName(name);
              if (!newWriters.has(sn))
                newWriters.set(sn, { writerNorm: sn, displayName: name, role: 'songwriter' });
            }
            return {
              statementId: id,
              lineNo: l.lineNo,
              period: l.period,
              writerName: l.writerName,
              writerNorm: norm,
              songwriters: l.songwriters,
              workTitle: l.workTitle,
              workCode: l.workCode,
              operationType: l.operationType,
              retailer: l.retailer,
              country: l.country,
              payablePico: l.payablePico,
            };
          });
          await repo.insertLines(rows);
          await repo.refreshLinesByKey();
          await repo.insertWritersIfAbsent([...newWriters.values()]);
          // A name seen first as a songwriter is upgraded to holder: a holder without owner gets one (unknown author).
          await repo.upgradeToHolders([...holders]);
          await repo.retryExternal([...holders]);
          const check = await repo.linesCheck(id);
          if (check.sum !== total || check.count !== BigInt(lines.length))
            throw new ValidationError('Control check failed for the statement');
          await repo.setStatementTotal(id, picoToString(total));
        });
      } catch (e) {
        if (created) await rm(storedPath, { force: true });
        if (isUniqueViolation(e)) {
          throw new ConflictError('This statement or its quarter is already loaded', 'duplicate_period');
        }
        throw e;
      }
      return rest.getStatement(id);
    }
  }

  const rest = {
    async getStatement(id: string): Promise<StatementView> {
      const s = await repo.getStatement(id);
      if (!s) throw new NotFoundError('Statement', id);
      return view(s);
    },

    async listStatements(): Promise<StatementView[]> {
      return (await repo.listStatements()).map(view);
    },

    async activeStatements(): Promise<
      { id: string; sha256: string; periods: string[]; fileName: string; labelId: string | null }[]
    > {
      return (await rest.listStatements())
        .filter((s) => s.status === 'loaded')
        .map((s) => ({ id: s.id, sha256: s.sha256, periods: s.periods, fileName: s.fileName, labelId: s.labelId }));
    },

    /**
     * Puts a statement loaded without a label under one (D-169, `scripts/assign-label-books.ts` only): a statement that
     * already has a label is never changed (`already_done`). Refreshes the grouped lines unless `refresh: false` (the
     * script refreshes them once after the last statement, `refreshLinesByKey()`).
     */
    async assignStatementLabel(
      id: string,
      labelId: string,
      o: { refresh?: boolean } = {},
    ): Promise<'assigned' | 'already_done'> {
      if (!(await repo.getStatement(id))) throw new NotFoundError('Statement', id);
      const changed = await tx(async () => {
        const done = await repo.assignStatementLabel(id, labelId);
        if (done && o.refresh !== false) await repo.refreshLinesByKey();
        return done;
      });
      return changed ? 'assigned' : 'already_done';
    },

    /** Rebuilds the grouped lines of the loaded statements (`pub_lines_by_key`). */
    refreshLinesByKey(): Promise<void> {
      return tx(() => repo.refreshLinesByKey());
    },

    // ---- writers ----
    /** Writers without an owner yet; songwriters marked external are retried (aliases may have been added since). */
    unmappedWriters(): Promise<
      { writerNorm: string; displayName: string; role: string; resolution: string }[]
    > {
      return repo.unmappedWriters();
    },

    /** A songwriter that is none of our owners: an external co-writer, not paid by us. */
    markWriterExternal(writerNorm: string): Promise<void> {
      return repo.setWriterResolution(writerNorm, 'external');
    },

    listWriters(): Promise<WriterRow[]> {
      return repo.allWriters();
    },

    async mapWriter(
      writerNorm: string,
      ownerId: string,
      resolution: 'matched' | 'created_waiting_documents' | 'manual' | 'merged',
    ): Promise<void> {
      if (!(await repo.getWriter(writerNorm))) throw new NotFoundError('Writer', writerNorm);
      await repo.mapWriter(writerNorm, ownerId, resolution);
    },

    markWriterAmbiguous(writerNorm: string): Promise<void> {
      return repo.setWriterResolution(writerNorm, 'ambiguous');
    },

    /** After a merge of owners the publishing identifier is replaced by the surviving owner. */
    reassignOwner(fromOwnerId: string, intoOwnerId: string): Promise<void> {
      return tx(async () => {
        // Terms stay with their record: they are resolved through the merge, and the surviving owner's own terms win.
        await repo.reassignWriters(fromOwnerId, intoOwnerId);
      });
    },

    // ---- contract terms ----
    /** The author's percentage of the money for our registered share (usually 50); the remainder stays with the label. */
    async setTerms(input: {
      ownerId: string;
      percent: string;
      validFrom: string;
      documentId?: string | null;
      /** Terms for one operation type; omitted = for any type. */
      operationType?: string | null;
    }): Promise<TermsRow | undefined> {
      if (!/^\d+(\.\d+)?$/.test(input.percent) || new Decimal(input.percent).gt(100)) {
        throw new ValidationError(`Invalid author percent "${input.percent}"`);
      }
      const validFrom = assertDate(input.validFrom);
      const operationType = input.operationType ?? null;
      if (operationType !== null && operationType.trim() === '')
        throw new ValidationError('Operation type must not be empty');
      return tx(async () => {
        const existing = (await repo.termsOfOwner(input.ownerId)).filter(
          (t) => t.operationType === operationType,
        );
        if (existing.some((t) => t.validFrom >= validFrom)) {
          throw new ConflictError('Publishing terms already start on or after this date', 'terms_overlap');
        }
        const open = existing.find((t) => t.validTo === null);
        if (open) {
          if (!input.documentId)
            throw new RuleViolationError(
              'Changing publishing terms requires a document',
              'document_required',
            );
          await repo.closeTerms(open.id, validFrom);
        }
        const id = newId();
        await repo.insertTerms({
          id,
          ownerId: input.ownerId,
          percent: input.percent,
          validFrom,
          validTo: null,
          documentId: input.documentId ?? null,
          operationType,
          createdAt: nowIso(),
        });
        return repo.getTerms(id);
      });
    },

    termsOf(ownerIds: string[]): Promise<TermsRow[]> {
      return repo.termsOfOwners(ownerIds);
    },

    allTerms(): Promise<TermsRow[]> {
      return repo.allTerms();
    },

    /**
     * Everything the facade needs to work out the publishing money, read from one consistent version (D-012):
     * writers, terms and the aggregated lines of the loaded statements. The module computes no money (D-128 part 2).
     */
    /** The B17 side of a calculation; `lines: false` (the unit scope of the facade, D-162) skips the statement lines. */
    snapshotForCalculation(o: { lines?: boolean } = {}): Promise<{ writers: WriterRow[]; terms: TermsRow[]; lines: AggregatedLine[] }> {
      return repo.snapshot(async () => ({
        writers: await repo.allWriters(),
        terms: await repo.allTerms(),
        lines: o.lines === false ? [] : await repo.aggregatedLines(),
      }));
    },
  };
  const service = { ...head, ...rest };
  return service;
}

export type PublishingService = ReturnType<typeof createPublishingService>;
