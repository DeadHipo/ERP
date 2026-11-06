import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { ValidationError } from '../shared/errors';
import { Decimal, ZERO } from '../shared/money';
import { parseBelieveExport, type ExportRelease, type ReleaseView } from '../modules/owners';
import type { FacadeContext } from './context';
import type { UnitResult } from './calculation';
import { ALL_VIEWER, labelForbidden, viewerHolds, type Viewer } from './viewer';

/**
 * The release registry of a label (D-172, plan «этап4_онбординг.md» §1.5): the rows of the Believe release export,
 * keyed `(org, label, upc)`. Navigation, not money (README §1 п. 8): the calculation never reads it
 * (`boundaries.test.ts`); the money of a release stays `GET /releases/:upc` over the units. Two signals compare it with
 * the units of the label's book: `releasesIncomplete`, `releasesUnknown`.
 */

/** The fields an import compares: a row whose fields are all equal is `unchanged` and is not rewritten. */
const FIELDS = [
  'title',
  'version',
  'artistString',
  'labelString',
  'releaseDate',
  'trackCount',
  'catalogNumber',
  'territories',
  'stores',
] as const satisfies readonly (keyof ExportRelease & keyof ReleaseView)[];

const sameRelease = (a: ExportRelease, b: ReleaseView) => FIELDS.every((k) => a[k] === b[k]);

async function sha256Of(path: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest('hex');
}

export interface ReleaseIncomplete {
  upc: string;
  labelId: string;
  title: string;
  trackCount: number;
  isrcsInUnits: number;
}

export interface ReleaseUnknown {
  upc: string;
  bookLabelId: string;
  releaseTitle: string;
  net: Decimal;
}

/**
 * The two release signals (pure; D-172). `releasesIncomplete`: a registry row whose `trackCount` is larger than the
 * distinct ISRCs of its UPC in the units of the book of the same label (0 when the UPC has no unit). `releasesUnknown`:
 * the UPCs of the units of a book whose label has a non-empty registry but no row of that UPC. Over every unit given
 * (the period is not applied: a release is complete or not over all the loaded files, as the registry read says);
 * under a label the caller passes the units of its files and its registry rows.
 */
export function releaseSignals(
  units: readonly Pick<UnitResult, 'isrc' | 'upc' | 'bookLabelId' | 'net'>[],
  registry: readonly Pick<ReleaseView, 'labelId' | 'upc' | 'title' | 'trackCount'>[],
  titleOf: (isrc: string, upc: string) => string,
): { releasesIncomplete: ReleaseIncomplete[]; releasesUnknown: ReleaseUnknown[] } {
  const byLabel = new Map<string, Set<string>>();
  for (const r of registry) (byLabel.get(r.labelId) ?? byLabel.set(r.labelId, new Set()).get(r.labelId))?.add(r.upc);
  const isrcs = new Map<string, Set<string>>();
  const unknown = new Map<string, ReleaseUnknown>();
  for (const u of units) {
    if (u.bookLabelId === null || u.upc === '') continue;
    const k = `${u.bookLabelId}|${u.upc}`;
    if (u.isrc !== '') (isrcs.get(k) ?? isrcs.set(k, new Set()).get(k))?.add(u.isrc);
    const known = byLabel.get(u.bookLabelId);
    if (!known || known.has(u.upc)) continue;
    const r = unknown.get(k);
    if (r) {
      r.net = r.net.add(u.net);
      if (!r.releaseTitle && u.isrc !== '') r.releaseTitle = titleOf(u.isrc, u.upc);
    } else
      unknown.set(k, {
        upc: u.upc,
        bookLabelId: u.bookLabelId,
        releaseTitle: u.isrc !== '' ? titleOf(u.isrc, u.upc) : '',
        net: ZERO.add(u.net),
      });
  }
  const releasesIncomplete = registry
    .map((r) => ({
      upc: r.upc,
      labelId: r.labelId,
      title: r.title,
      trackCount: r.trackCount ?? 0,
      isrcsInUnits: isrcs.get(`${r.labelId}|${r.upc}`)?.size ?? 0,
    }))
    .filter((r) => r.trackCount > r.isrcsInUnits)
    .sort((a, b) => a.labelId.localeCompare(b.labelId) || a.upc.localeCompare(b.upc));
  const releasesUnknown = [...unknown.values()].sort((a, b) => b.net.cmp(a.net) || a.upc.localeCompare(b.upc));
  return { releasesIncomplete, releasesUnknown };
}

export function releaseRegistryApi(ctx: FacadeContext) {
  const { db, owners, sources, labels, assertOwnLabel } = ctx;
  return {
    /**
     * Imports the Believe release export of an own label (D-172): every row is inserted or rewritten by `(org, label,
     * upc)` in one transaction, all or nothing; a row equal to the stored one is `unchanged` and not rewritten; the UPCs
     * of the registry that the file does not list stay (an export may be partial). `400 label_required`, `404`, `400
     * label_not_own`, a viewer of other labels `403 label_forbidden`; the file: `400 release_import_header`, `413
     * import_too_large`, `422 release_import_invalid` (nothing is written).
     */
    async importReleases(input: { path: string; fileName: string; labelId: string | undefined }, viewer: Viewer = ALL_VIEWER) {
      if (!input.labelId) throw new ValidationError('Choose a label: ?label=', undefined, 'label_required');
      const label = await assertOwnLabel(input.labelId);
      if (!viewerHolds(viewer, label.id)) throw labelForbidden();
      const rows = await parseBelieveExport(createReadStream(input.path));
      const sha256 = await sha256Of(input.path);
      return db.transaction(async () => {
        const stored = new Map(
          (await owners.releases.list({ labelId: label.id, upcs: rows.map((r) => r.upc) })).map((r) => [r.upc, r]),
        );
        let inserted = 0;
        let updated = 0;
        const changed = rows.filter((r) => {
          const s = stored.get(r.upc);
          if (!s) inserted += 1;
          else if (!sameRelease(r, s)) updated += 1;
          else return false;
          return true;
        });
        await owners.releases.upsert(
          label.id,
          changed.map(({ line: _line, ...r }) => ({ ...r, fileSha256: sha256 })),
        );
        return {
          labelId: label.id,
          fileName: input.fileName,
          sha256,
          rows: rows.length,
          inserted,
          updated,
          unchanged: rows.length - inserted - updated,
        };
      });
    },

    /**
     * The release registry (D-172), no money: under a label its rows, under «Все» the rows of every label (a UPC
     * moved between labels is a row per label). `isrcsInUnits` = the distinct ISRCs of the UPC in the loaded files of
     * the row's label; `q` filters UPC, title, version, artist string, catalog number.
     */
    async releaseRegistry(f: { label?: string; q?: string } = {}) {
      const only = f.label === undefined ? undefined : (await assertOwnLabel(f.label)).id;
      const [rows, labelList] = await db.snapshot(async () => [await owners.releases.list(only ? { labelId: only } : {}), await labels.listLabels()] as const);
      const needle = f.q?.trim().toLowerCase();
      const shown = rows.filter(
        (r) =>
          !needle ||
          r.upc.includes(needle) ||
          [r.title, r.version, r.artistString, r.catalogNumber].some((v) => v?.toLowerCase().includes(needle)),
      );
      const names = new Map(labelList.map((l) => [l.id, l.name]));
      const counts = new Map<string, number>();
      for (const labelId of new Set(shown.map((r) => r.labelId))) {
        const fileIds = (await sources.filesOfLabel(labelId)).map((x) => x.id);
        const upcs = shown.filter((r) => r.labelId === labelId).map((r) => r.upc);
        for (const x of await sources.isrcsOfUpcs(fileIds, upcs)) counts.set(`${labelId}|${x.upc}`, x.isrcs.length);
      }
      return {
        items: shown.map((r) => ({
          labelId: r.labelId,
          labelName: names.get(r.labelId) ?? '?',
          upc: r.upc,
          title: r.title,
          version: r.version,
          artistString: r.artistString,
          labelString: r.labelString,
          releaseDate: r.releaseDate,
          trackCount: r.trackCount,
          catalogNumber: r.catalogNumber,
          territories: r.territories,
          stores: r.stores,
          isrcsInUnits: counts.get(`${r.labelId}|${r.upc}`) ?? 0,
          importedAt: r.importedAt,
        })),
      };
    },
  };
}
