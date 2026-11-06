/**
 * The stage 4 split diff as a split import file (D-172): `annex/splits_diff.json` (+ `annex/participations.json` for
 * the ISRCs the participations step rewrites) → a csv of the template columns (`SPLIT_IMPORT_COLUMNS`), loaded by
 * `POST /splits/import` instead of the loader's `splits` step.
 *
 * Usage: npx tsx packages/backend/scripts/mvp/splits-diff-to-csv.ts [<load dir>] [--out <file.csv>]
 *   <load dir> defaults to MVP_LOAD_DIR or <repo>/data/mvp-load; the csv goes to stdout without --out.
 *
 * The same records, in the same order, with the same filters as `stepSplits` (`steps-annex.ts`): `same` / `erp_only`
 * and `different_period` skipped, every class but `missing_in_erp` / `different_rows` skipped, M51 ISRCs, ISRCs of the
 * participations' `splitRewrites`, `different_rows` with a `pp` buyout whose ERP period is present, only rows with a
 * percent above 0, a record without rows skipped, `from ?? '2000-01-01'`. `artist_id` is always written (the import
 * never resolves an ambiguous name «by contract» as the loader does); `note` is the loader's marker
 * `mvp:splits:<isrc>:<from>`. The loader's `already_done` (a marker already in the database) has no file form: a
 * second import of the same file classifies those groups as `unchanged` instead. No personal data is printed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Decimal } from '../../src/shared/money';
import { SPLIT_IMPORT_COLUMNS } from '@erp/shared/split-import';

/** The document the loader's `splits` step confirms every split with (`ensureDoc` in `stepSplits`). */
export const ANNEX_DOCUMENT_TITLE = 'Annex 14 Splits by ISRC 2026-11-02';

export interface SplitDiffJson {
  records: {
    isrc: string;
    classification: string;
    subtype?: string;
    annex: { period: { from: string | null }; rowsExpected: { name: string; percent: number; artistId: string | null }[] };
  }[];
  buyouts: { isrc?: string; interestKind: string; erpSplitsStartingInEffectiveMonth: unknown[] }[];
  m51SeeInstrument: { isrc: string }[];
}
export interface ParticipationsJson {
  splitRewrites: { isrc: string }[];
}

const pct = (n: number | string): string => new Decimal(String(n)).toDecimalPlaces(6).toFixed();
const field = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** The csv text (header + one line per artist row), in the loader's record order. */
export function splitsDiffToCsv(diff: SplitDiffJson, parts: ParticipationsJson, documentTitle = ANNEX_DOCUMENT_TITLE): string {
  const rewrites = new Set(parts.splitRewrites.map((r) => r.isrc));
  const m51 = new Set(diff.m51SeeInstrument.map((m) => m.isrc));
  const ppPresent = new Set(
    diff.buyouts
      .filter((b) => b.isrc && b.interestKind === 'pp' && b.erpSplitsStartingInEffectiveMonth.length > 0)
      .map((b) => b.isrc as string),
  );
  const header = SPLIT_IMPORT_COLUMNS.map((c) => c.name);
  const lines = [header.join(',')];
  for (const rec of diff.records) {
    const c = rec.classification;
    if (c !== 'missing_in_erp' && c !== 'different_rows') continue; // same, erp_only, different_period, others
    if (m51.has(rec.isrc) || rewrites.has(rec.isrc)) continue;
    if (c === 'different_rows' && ppPresent.has(rec.isrc)) continue;
    const from = rec.annex.period.from ?? '2000-01-01';
    const rows = rec.annex.rowsExpected.filter((r) => r.percent > 0);
    for (const r of rows) {
      const cells: Record<string, string> = {
        isrc: rec.isrc,
        pseudonym: r.name,
        percent: pct(r.percent),
        from,
        to: '',
        owner: '',
        document: documentTitle,
        artist_id: r.artistId ?? '',
        note: `mvp:splits:${rec.isrc}:${from}`,
      };
      lines.push(header.map((h) => field(cells[h] ?? '')).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args[outAt + 1] : undefined;
  const positional = args.filter((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1));
  const dir =
    positional[0] ?? process.env.MVP_LOAD_DIR ?? join(resolve(import.meta.dirname, '..', '..', '..', '..'), 'data', 'mvp-load');
  const read = <T>(rel: string) => JSON.parse(readFileSync(join(dir, rel), 'utf8')) as T;
  const csv = splitsDiffToCsv(read<SplitDiffJson>('annex/splits_diff.json'), read<ParticipationsJson>('annex/participations.json'));
  if (out) {
    writeFileSync(out, csv);
    console.log(`${csv.split('\n').length - 2} rows -> ${out}`);
  } else process.stdout.write(csv);
}
