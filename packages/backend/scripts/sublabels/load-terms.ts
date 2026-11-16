/**
 * D-221: the terms of the sublabels from one csv (step 5 of `docs/идеи/выписка_и_саблейблы/план_разработки.md`).
 * Columns (`;`, a header row): `sublabel;isrc;percent;valid_from;valid_to;document_id;note`. `sublabel` is the name in
 * the register (without case) or its id; `valid_to` and `document_id` may be empty (no document = the money waits);
 * months as `YYYY-MM` or a date (floored, M52). The rows of one sublabel, document and note are one batch of
 * `addSublabelTerms` (≤ 5 000 tracks): the same classification as the API (new / closes / unchanged / errors), all or
 * nothing per batch. A sublabel missing from the register is created only with `--apply`. Nothing reads money.
 *
 * Dry run by default (the preview of every batch, nothing written, no audit row); `--apply` writes and records each
 * batch in the audit as `POST /sublabels/:id/terms` with the operator `--operator <login>` (default `loader`).
 * Report: `<out>/load_terms_report.csv` (every row with its class).
 *
 *   npx tsx packages/backend/scripts/sublabels/load-terms.ts <file.csv> [--out data/mvp-load/sublabels] [--operator <login>] [--apply] [--org <id>] [dataDir]
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { parseCsv } from '../../src/shared/csv';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const valueOf = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = resolve(valueOf('--out') ?? 'data/mvp-load/sublabels');
const operator = valueOf('--operator') ?? 'loader';
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--operator');
const [file, dataDirArg] = positional;
if (!file) {
  console.error('usage: load-terms.ts <file.csv> [--out <dir>] [--operator <login>] [--apply] [--org <id>] [dataDir]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));
const COLUMNS = ['sublabel', 'isrc', 'percent', 'valid_from', 'valid_to', 'document_id', 'note'] as const;
const MAX_BATCH = 5000;

async function readCsv(path: string): Promise<{ line: number; row: Record<string, string> }[]> {
  const rows: { line: number; row: Record<string, string> }[] = [];
  let header: string[] | undefined;
  let line = 0;
  for await (const rec of parseCsv(createReadStream(path), ';')) {
    line += 1;
    if (!header) {
      header = rec.map((h) => h.replace(/^\uFEFF/, '').trim().toLowerCase());
      const missing = COLUMNS.filter((c) => c !== 'valid_to' && c !== 'document_id' && c !== 'note' && !header?.includes(c));
      if (missing.length > 0) throw new Error(`missing columns: ${missing.join(', ')}`);
      continue;
    }
    if (rec.every((v) => v.trim() === '')) continue;
    rows.push({ line, row: Object.fromEntries(header.map((h, i) => [h, (rec[i] ?? '').trim()])) });
  }
  return rows;
}

const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const input = await readCsv(resolve(file));
  const register = await f.listSublabels();
  const byKey = new Map<string, { id: string; name: string }>();
  for (const s of register) {
    byKey.set(s.id, s);
    byKey.set(s.name.toLowerCase(), s);
  }

  // batches: one sublabel, one document, one note
  const batches = new Map<string, { sublabel: string; documentId: string | null; note: string | null; rows: typeof input }>();
  for (const r of input) {
    const sub = r.row.sublabel ?? '';
    const documentId = r.row.document_id || null;
    const note = r.row.note || null;
    const key = JSON.stringify([sub.toLowerCase(), documentId, note]);
    const b = batches.get(key) ?? { sublabel: sub, documentId, note, rows: [] };
    b.rows.push(r);
    batches.set(key, b);
  }

  const report: string[] = [['line', 'sublabel', 'isrc', 'percent', 'valid_from', 'valid_to', 'document_id', 'kind', 'error', 'not_in_catalog', 'closes'].join(';')];
  const totals = { rows: 0, new: 0, closes: 0, unchanged: 0, errors: 0, notInCatalog: 0, created: 0, sublabelsCreated: 0, sublabelsMissing: 0 };
  for (const b of batches.values()) {
    let sublabel = byKey.get(b.sublabel) ?? byKey.get(b.sublabel.toLowerCase());
    if (!sublabel) {
      if (!apply) {
        totals.sublabelsMissing += 1;
        console.log(`sublabel «${b.sublabel}» is not in the register: created with --apply; ${b.rows.length} rows not checked`);
        for (const r of b.rows) report.push([r.line, b.sublabel, r.row.isrc ?? '', r.row.percent ?? '', r.row.valid_from ?? '', r.row.valid_to ?? '', b.documentId ?? '', 'sublabel_missing', '', '', ''].map((x) => quote(String(x))).join(';'));
        continue;
      }
      const created = await f.createSublabel(b.sublabel);
      await f.recordAction({ operator, method: 'POST', route: '/sublabels', entityIds: [created.id], summary: { id: created.id } });
      sublabel = created;
      byKey.set(created.id, created);
      byKey.set(created.name.toLowerCase(), created);
      totals.sublabelsCreated += 1;
    }
    for (let i = 0; i < b.rows.length; i += MAX_BATCH) {
      const chunk = b.rows.slice(i, i + MAX_BATCH);
      const first = chunk[0]?.row ?? {};
      const body = {
        documentId: b.documentId,
        note: b.note,
        percent: first.percent ?? '',
        validFrom: first.valid_from ?? '',
        validTo: first.valid_to || null,
        items: chunk.map((r) => ({
          isrc: r.row.isrc ?? '',
          percent: r.row.percent || null,
          validFrom: r.row.valid_from || null,
          validTo: r.row.valid_to || null,
        })),
      };
      const preview = await f.addSublabelTerms(sublabel.id, body, { dryRun: true }, operator);
      let result = preview;
      if (apply && preview.totals.errors === 0 && preview.totals.new + preview.totals.closes > 0) {
        result = await f.addSublabelTerms(sublabel.id, body, { dryRun: false }, operator);
        await f.recordAction({
          operator,
          method: 'POST',
          route: '/sublabels/:id/terms',
          entityIds: [sublabel.id, ...result.termIds],
          summary: { sublabelId: sublabel.id, documentId: b.documentId, created: result.termIds.length, ...result.totals },
        });
        totals.created += result.termIds.length;
      } else if (apply && preview.totals.errors > 0) {
        console.log(`sublabel «${sublabel.name}»: ${preview.totals.errors} error rows, the batch is not written`);
      }
      for (const k of ['rows', 'new', 'closes', 'unchanged', 'errors', 'notInCatalog'] as const) totals[k] += preview.totals[k];
      for (const r of preview.rows) {
        const src = chunk[r.line - 1];
        report.push(
          [src?.line ?? '', sublabel.name, r.isrc, r.percent ?? '', r.validFrom ?? '', r.validTo ?? '', b.documentId ?? '', r.kind, r.error ?? '', r.notInCatalog ? '1' : '', r.closes ? `${r.closes.sublabelName} ${r.closes.percent}% ${r.closes.validFrom}` : '']
            .map((x) => quote(String(x)))
            .join(';'),
        );
      }
    }
  }
  mkdirSync(out, { recursive: true });
  const reportPath = join(out, 'load_terms_report.csv');
  writeFileSync(reportPath, `\uFEFF${report.join('\n')}\n`);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', batches: batches.size, ...totals, report: reportPath }, null, 2));
} finally {
  await stack.close();
}
