import { createReadStream } from 'node:fs';
import { ConflictError, ValidationError } from '../shared/errors';
import { RELEASE_READERS, type ExportRelease, type ReleaseRowCode, type ReleaseSource, type ReleaseView } from '../modules/owners';
import type { FacadeContext } from './context';
import { ALL_VIEWER, labelForbidden, viewerHolds, type Viewer } from './viewer';

/**
 * The release registry of a label (D-172, D-195): the rows of a release export, keyed `(org, label, upc)`. Navigation,
 * not money (README §1 п. 8): the calculation never reads it (`boundaries.test.ts`); the money of a release stays
 * `GET /releases/:upc` over the units. A new export is previewed against the registry (nothing written) and the operator
 * applies the changes he accepts; no file is kept, the audit says who changed what. Two signals compare it with the
 * units of the label's book: `releasesIncomplete`, `releasesUnknown`.
 */

/** The fields of a release a preview compares and an apply writes. */
export const RELEASE_FIELDS = [
  'releaseTitle',
  'version',
  'artistString',
  'labelString',
  'releasedAt',
  'trackCount',
  'catalogNumber',
  'territories',
  'stores',
] as const satisfies readonly (keyof ExportRelease & keyof ReleaseView)[];

export type ReleaseFields = Pick<ReleaseView, (typeof RELEASE_FIELDS)[number]>;

const fieldsOf = (r: ReleaseFields): ReleaseFields => {
  const out = {} as Record<string, unknown>;
  for (const k of RELEASE_FIELDS) out[k] = r[k];
  return out as ReleaseFields;
};
const show = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
/** The fields that differ, `before` = the registry, `after` = the export. */
const diff = (before: ReleaseFields, after: ReleaseFields) =>
  RELEASE_FIELDS.filter((k) => before[k] !== after[k]).map((field) => ({ field, before: show(before[field]), after: show(after[field]) }));

/** A row of the preview (the unchanged rows are only counted). */
export interface ReleasePreviewItem {
  line: number;
  upc: string | null;
  action: 'create' | 'update' | 'error' | 'duplicate';
  release: ReleaseFields | null;
  before: ReleaseFields | null;
  changes: { field: (typeof RELEASE_FIELDS)[number]; before: string | null; after: string | null }[];
  codes: ReleaseRowCode[];
}

/** A registry release whose track count differs from the distinct ISRCs of its UPC in the label's reports (D-196). */
export interface ReleaseIncomplete {
  upc: string;
  labelId: string;
  title: string;
  trackCount: number;
  isrcsInUnits: number;
}

/** A UPC of the label's reports that its release registry does not list (D-196): no money, what and until when. */
export interface ReleaseUnknown {
  upc: string;
  bookLabelId: string;
  releaseTitle: string;
  artistName: string;
  isrcs: string[];
  lastMonth: string;
}

/** A registry release without a release date (D-196). */
export interface ReleaseWithoutDate {
  upc: string;
  labelId: string;
  releaseTitle: string;
}

/** One label's side of the release signals: its registry and the UPCs of its loaded files with their ISRCs. */
export interface ReleaseBook {
  labelId: string;
  registry: readonly Pick<ReleaseView, 'upc' | 'releaseTitle' | 'trackCount' | 'releasedAt'>[];
  upcs: readonly { upc: string; isrcs: string[]; lastMonth: string }[];
}

/**
 * The three release signals (pure; D-172, D-196): «something is wrong», never money. A label without a registry has
 * none (else its whole catalogue would be «unknown»). `releasesIncomplete`: a registry release whose UPC is in the
 * reports with a number of distinct ISRCs other than its track count (a release not in the reports at all is not a
 * signal: new or not selling). `releasesUnknown`: a UPC of the reports not in the registry. `releasesWithoutDate`: a
 * registry row without a release date. Over every loaded file of the label (the period is not applied).
 */
export function releaseSignals(
  books: readonly ReleaseBook[],
  attrsOf: (isrc: string, upc: string) => { releaseTitle: string; artistName: string } | undefined,
): { releasesIncomplete: ReleaseIncomplete[]; releasesUnknown: ReleaseUnknown[]; releasesWithoutDate: ReleaseWithoutDate[] } {
  const releasesIncomplete: ReleaseIncomplete[] = [];
  const releasesUnknown: ReleaseUnknown[] = [];
  const releasesWithoutDate: ReleaseWithoutDate[] = [];
  for (const b of books) {
    if (b.registry.length === 0) continue;
    const inReports = new Map(b.upcs.map((u) => [u.upc, u]));
    const known = new Set(b.registry.map((r) => r.upc));
    for (const r of b.registry) {
      const seen = inReports.get(r.upc)?.isrcs.length ?? 0;
      if (seen > 0 && r.trackCount !== null && seen !== r.trackCount)
        releasesIncomplete.push({ upc: r.upc, labelId: b.labelId, title: r.releaseTitle, trackCount: r.trackCount, isrcsInUnits: seen });
      if (r.releasedAt === null) releasesWithoutDate.push({ upc: r.upc, labelId: b.labelId, releaseTitle: r.releaseTitle });
    }
    for (const u of b.upcs) {
      if (known.has(u.upc)) continue;
      const a = u.isrcs.map((i) => attrsOf(i, u.upc)).find((x) => x !== undefined);
      releasesUnknown.push({
        upc: u.upc,
        bookLabelId: b.labelId,
        releaseTitle: a?.releaseTitle ?? '',
        artistName: a?.artistName ?? '',
        isrcs: u.isrcs,
        lastMonth: u.lastMonth,
      });
    }
  }
  const byLabelUpc = (a: { upc: string }, b: { upc: string }, la: string, lb: string) => la.localeCompare(lb) || a.upc.localeCompare(b.upc);
  releasesIncomplete.sort((a, b) => byLabelUpc(a, b, a.labelId, b.labelId));
  releasesWithoutDate.sort((a, b) => byLabelUpc(a, b, a.labelId, b.labelId));
  // the ones still in the latest reports first
  releasesUnknown.sort((a, b) => b.lastMonth.localeCompare(a.lastMonth) || byLabelUpc(a, b, a.bookLabelId, b.bookLabelId));
  return { releasesIncomplete, releasesUnknown, releasesWithoutDate };
}

/** A registry row of the API (D-195): `releaseDate` is the day of `releasedAt`, for the readers that need only the day. */
export const registryRowOf = (r: ReleaseView, labelName: string) => ({
  labelId: r.labelId,
  labelName,
  upc: r.upc,
  releaseTitle: r.releaseTitle,
  version: r.version,
  artistString: r.artistString,
  labelString: r.labelString,
  releasedAt: r.releasedAt,
  releaseDate: r.releasedAt ? r.releasedAt.slice(0, 10) : null,
  trackCount: r.trackCount,
  catalogNumber: r.catalogNumber,
  territories: r.territories,
  stores: r.stores,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export function releaseRegistryApi(ctx: FacadeContext) {
  const { db, owners, sources, labels, assertOwnLabel } = ctx;
  return {
    /**
     * The preview of a release export against the registry of an own label (D-195): nothing is written. Every line of
     * the file is `create` (a new UPC), `update` (the fields that differ), `unchanged` (only counted), `error` (the codes
     * of the line; a UPC whose lines disagree is an error on every line) or `duplicate` (a repeated line equal to the
     * first: ignored). `missing` = the UPCs of the registry the file does not list: they stay. `400 label_required`,
     * `404`, `400 label_not_own`, a viewer of other labels `403 label_forbidden`; the file: `400 release_import_header`,
     * `413 import_too_large`.
     */
    async previewReleases(
      input: { path: string; fileName: string; labelId: string | undefined; source: ReleaseSource },
      viewer: Viewer = ALL_VIEWER,
    ) {
      if (!input.labelId) throw new ValidationError('Choose a label: ?label=', undefined, 'label_required');
      const label = await assertOwnLabel(input.labelId);
      if (!viewerHolds(viewer, label.id)) throw labelForbidden();
      const { rows, issues } = await RELEASE_READERS[input.source](createReadStream(input.path));
      const stored = new Map((await owners.releases.list({ labelId: label.id })).map((r) => [r.upc, r]));
      const items: ReleasePreviewItem[] = issues.map((i) => ({ line: i.line, upc: i.upc, action: 'error', release: null, before: null, changes: [], codes: i.codes }));
      const byUpc = new Map<string, ExportRelease[]>();
      for (const r of rows) (byUpc.get(r.upc) ?? byUpc.set(r.upc, []).get(r.upc))?.push(r);
      let unchanged = 0;
      for (const [upc, lines] of byUpc) {
        const first = lines[0] as ExportRelease;
        const release = fieldsOf(first);
        if (lines.some((l) => diff(release, fieldsOf(l)).length > 0)) {
          for (const l of lines) items.push({ line: l.line, upc, action: 'error', release: fieldsOf(l), before: null, changes: [], codes: ['duplicate_upc'] });
          continue;
        }
        for (const l of lines.slice(1)) items.push({ line: l.line, upc, action: 'duplicate', release, before: null, changes: [], codes: [] });
        const s = stored.get(upc);
        if (!s) items.push({ line: first.line, upc, action: 'create', release, before: null, changes: [], codes: [] });
        else {
          const before = fieldsOf(s);
          const changes = diff(before, release);
          if (changes.length === 0) unchanged += 1;
          else items.push({ line: first.line, upc, action: 'update', release, before, changes, codes: [] });
        }
      }
      items.sort((a, b) => a.line - b.line);
      const listed = new Set(rows.map((r) => r.upc));
      const missing = [...stored.values()].filter((r) => !listed.has(r.upc)).map((r) => ({ upc: r.upc, releaseTitle: r.releaseTitle }));
      const count = (a: ReleasePreviewItem['action']) => items.filter((i) => i.action === a).length;
      return {
        labelId: label.id,
        source: input.source,
        fileName: input.fileName,
        totals: {
          rows: rows.length + issues.length,
          create: count('create'),
          update: count('update'),
          unchanged,
          error: count('error'),
          duplicate: count('duplicate'),
          missing: missing.length,
        },
        items,
        missing,
      };
    },

    /**
     * Applies the changes of a preview the operator accepted (D-195), in one transaction, all or nothing: a `create`
     * needs the UPC absent from the registry of the label, an `update` needs the row equal to its `before`; otherwise
     * `409 release_changed` (`details.upcs`): the registry moved since the preview, preview again. The same refusals of
     * the label as the preview.
     */
    async applyReleases(
      input: { labelId: string | undefined; changes: { upc: string; action: 'create' | 'update'; release: ReleaseFields; before: ReleaseFields | null }[] },
      viewer: Viewer = ALL_VIEWER,
    ) {
      if (!input.labelId) throw new ValidationError('Choose a label: ?label=', undefined, 'label_required');
      const label = await assertOwnLabel(input.labelId);
      if (!viewerHolds(viewer, label.id)) throw labelForbidden();
      if (new Set(input.changes.map((c) => c.upc)).size !== input.changes.length)
        throw new ValidationError('A UPC is listed twice', undefined, 'duplicate_upc');
      return db.transaction(async () => {
        const stored = new Map((await owners.releases.list({ labelId: label.id, upcs: input.changes.map((c) => c.upc) })).map((r) => [r.upc, r]));
        const moved = input.changes
          .filter((c) => {
            const s = stored.get(c.upc);
            if (c.action === 'create') return s !== undefined;
            return !s || !c.before || diff(fieldsOf(s), fieldsOf(c.before)).length > 0;
          })
          .map((c) => c.upc);
        if (moved.length > 0)
          throw new ConflictError(`The registry changed since the preview: ${moved.slice(0, 20).join(', ')}`, 'release_changed', { upcs: moved });
        await owners.releases.upsert(label.id, input.changes.map((c) => ({ upc: c.upc, ...fieldsOf(c.release) })));
        return {
          labelId: label.id,
          created: input.changes.filter((c) => c.action === 'create').length,
          updated: input.changes.filter((c) => c.action === 'update').length,
          upcs: input.changes.map((c) => c.upc).sort(),
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
          [r.releaseTitle, r.version, r.artistString, r.catalogNumber].some((v) => v?.toLowerCase().includes(needle)),
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
          ...registryRowOf(r, names.get(r.labelId) ?? '?'),
          isrcsInUnits: counts.get(`${r.labelId}|${r.upc}`) ?? 0,
        })),
      };
    },
  };
}
