import type { ArtistView, ReleaseView, TrackView, TrackViewMeta } from '@erp/shared/api-responses';
import { baseTitleOf } from '@erp/shared/track-title';
import { assertIsrc } from '../shared/identifiers';
import type { FacadeContext } from './context';
import { registryRowOf } from './release-registry';
import { artistsByIsrc } from './track-artists';
import { ALL_VIEWER, viewerSees, type Viewer } from './viewer';

// The track directory (D-245): what a screen needs to show a track, its releases and its pseudonyms, as three maps
// keyed by ISRC, UPC and pseudonym id. Navigation, not money: nothing here calculates, and this file imports neither
// the calculation nor the money aggregates (`tests/boundaries.test.ts`). Every title is given as it is stored; the
// screen chooses which one to show.

type Ctx = Pick<FacadeContext, 'owners' | 'labels' | 'sources'>;

/** The names of the report pairs (ISRC|UPC) and, per ISRC, those of its first pair in key order (deterministic). */
export async function nameMaps(ctx: Pick<Ctx, 'sources'>, filter: { isrcs?: string[]; upcs?: string[]; labelIds?: string[] } = {}) {
  const attrs = await ctx.sources.pairAttributes(filter);
  const byIsrc = new Map<string, { artistName: string; trackTitle: string }>();
  // deterministic: the first pair of an ISRC in key order
  for (const k of [...attrs.keys()].sort()) {
    const isrc = k.split('|')[0] as string;
    if (!byIsrc.has(isrc)) byIsrc.set(isrc, attrs.get(k) as { artistName: string; trackTitle: string });
  }
  return { attrs, byIsrc };
}

/** The release registry rows by UPC (D-172, navigation): of one label or of every label, with the label name. */
export async function registryByUpc(
  ctx: Pick<Ctx, 'owners' | 'labels'>,
  labelId: string | undefined,
  upcs?: string[],
  /** The label names, when the caller has read them already. */
  labelNames?: Map<string, string>,
) {
  const names = labelNames ?? new Map((await ctx.labels.listLabels()).map((l) => [l.id, l.name]));
  const rows = await ctx.owners.releases.list({ ...(labelId === undefined ? {} : { labelId }), ...(upcs ? { upcs } : {}) });
  const out = new Map<string, ReturnType<typeof registryRowOf>[]>();
  for (const r of rows) {
    const list = out.get(r.upc) ?? out.set(r.upc, []).get(r.upc);
    list?.push(registryRowOf(r, names.get(r.labelId) ?? '?'));
  }
  return out;
}

/** An empty string is «no value» (D-243). */
const orNull = (v: string | null | undefined): string | null => (v === null || v === undefined || v === '' ? null : v);

/** Plain code-unit order, the same on every machine. */
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function tracksApi(ctx: FacadeContext) {
  const { owners, splits, labels, db } = ctx;
  return {
    /**
     * The track directory of some ISRCs (D-245): `tracks` by ISRC, and the `releases` (by UPC) and `artists` (by
     * pseudonym id) that at least one of those tracks names. No money.
     *
     * A viewer of some labels (D-171) gets the catalog side of any ISRC of the organization (`catalogTitle`, `meta`,
     * `catalogLabel`), and the report side (`reportTitle`, `upcs`, `artists`) only of an ISRC of the ISRC rule: on
     * another one they are null, and its UPCs and pseudonyms do not reach the maps. A release carries the registry
     * row of a label the viewer has (the last updated one), else only the release title of the reports of the files
     * of the viewer's labels.
     *
     * An ISRC with no track row, no report pair, no meta and no open label interval is absent from the answer; for a
     * viewer who may not touch the ISRC its report pair does not count (it answers as an unknown ISRC).
     */
    async tracksOf(isrcsRaw: string[], viewer: Viewer = ALL_VIEWER): Promise<{
      tracks: Record<string, TrackView>;
      releases: Record<string, ReleaseView>;
      artists: Record<string, ArtistView>;
    }> {
      const isrcs = [...new Set(isrcsRaw.map(assertIsrc))].sort(cmp);
      if (isrcs.length === 0) return { tracks: {}, releases: {}, artists: {} };
      // the ISRC rule of the viewer (D-171) and the report pairs: ClickHouse, read before the PostgreSQL snapshot
      const mayTouch = await ctx.scopeOf(viewer).isrcFilter();
      const { attrs, byIsrc } = await nameMaps(ctx, { isrcs });
      // the release title of the reports (the fallback of a release without a visible registry row): for a viewer of
      // some labels only from the pairs of the files of its labels, as its release pages read them (D-168)
      const ownAttrs = viewer.kind === 'all' ? attrs : (await nameMaps(ctx, { isrcs, labelIds: [...viewer.labelIds] })).attrs;
      const pairUpcs = new Map<string, Set<string>>();
      for (const k of attrs.keys()) {
        const [isrc, upc] = k.split('|') as [string, string];
        if (isrc === '') continue;
        (pairUpcs.get(isrc) ?? pairUpcs.set(isrc, new Set()).get(isrc))?.add(upc);
      }

      const read = await db.snapshot(async () => {
        const trackRows = await owners.listTracks({ isrcs });
        const meta = await owners.trackMeta.of(isrcs);
        const history = await owners.trackLabels.list({ isrcs });
        const labelNames = new Map((await labels.listLabels()).map((l) => [l.id, l.name]));
        const index = await owners.artistIndex();
        const artistsOf = artistsByIsrc({
          splits: await splits.listSplits({ isrcs }),
          participations: await splits.listParticipations({ isrcs }),
          index,
        });
        const upcs = [
          ...new Set([...[...pairUpcs.values()].flatMap((s) => [...s]), ...trackRows.map((t) => t.upc ?? '')].filter((u) => u !== '')),
        ];
        const registry = await registryByUpc(ctx, undefined, upcs, labelNames);
        return { trackRows, meta, history, labelNames, index, artistsOf, registry };
      });

      // the rows of `owners.tracks` of an ISRC in the order (upc, id), a row without a UPC last (as ORDER BY upc, id)
      const rowsOf = new Map<string, typeof read.trackRows>();
      for (const t of read.trackRows) if (t.isrc) (rowsOf.get(t.isrc) ?? rowsOf.set(t.isrc, []).get(t.isrc))?.push(t);
      for (const list of rowsOf.values())
        list.sort((a, b) => (a.upc === null ? (b.upc === null ? 0 : 1) : b.upc === null ? -1 : cmp(a.upc, b.upc)) || cmp(a.id, b.id));
      const metaOf = new Map(read.meta.map((m) => [m.isrc, m]));
      const open = new Map(read.history.filter((h) => h.validTo === null).map((h) => [h.isrc, h]));

      const tracks: Record<string, TrackView> = {};
      const releases: Record<string, ReleaseView> = {};
      const artists: Record<string, ArtistView> = {};
      for (const isrc of isrcs) {
        const rows = rowsOf.get(isrc) ?? [];
        const m = metaOf.get(isrc);
        const h = open.get(isrc);
        const visible = mayTouch(isrc);
        // a report pair counts only for an ISRC the viewer may touch: one known only by a pair of another book's files
        // answers as an unknown ISRC
        if (rows.length === 0 && !m && !h && !(visible && pairUpcs.has(isrc))) continue;
        const meta: TrackViewMeta | null = m
          ? {
              title: orNull(m.title),
              baseTitle: baseTitleOf(orNull(m.title), orNull(m.version)),
              version: orNull(m.version),
              artists: orNull(m.artists),
              durationMs: m.durationMs,
              explicit: m.explicit,
              releaseDate: m.releaseDate,
              coverUrl: orNull(m.coverUrl),
              primaryPlatform: orNull(m.primaryPlatform),
            }
          : null;
        const upcs = visible
          ? [...new Set([...(pairUpcs.get(isrc) ?? []), ...rows.map((t) => t.upc ?? '')].filter((u) => u !== ''))].sort(cmp)
          : null;
        const refs = visible ? (read.artistsOf.get(isrc) ?? []) : null;
        tracks[isrc] = {
          isrc,
          catalogTitle: orNull(rows.find((t) => t.title !== '')?.title),
          reportTitle: visible ? orNull(byIsrc.get(isrc)?.trackTitle) : null,
          meta,
          catalogLabel: h ? { id: h.labelId, name: read.labelNames.get(h.labelId) ?? '?' } : null,
          upcs,
          artists: refs ? refs.map((a) => a.id) : null,
        };
        for (const upc of upcs ?? []) {
          // the registry row of a label the viewer has: the last updated one, then the smaller label id (as `registryRows`)
          const row = (read.registry.get(upc) ?? [])
            .filter((r) => viewerSees(viewer, r.labelId))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.labelId.localeCompare(b.labelId))[0];
          if (row) {
            releases[upc] = {
              upc,
              title: orNull(row.releaseTitle),
              version: orNull(row.version),
              releaseDate: orNull(row.releasedAt),
              labelName: row.labelName,
              trackCount: row.trackCount,
            };
            continue;
          }
          // no visible registry row: the release title of the reports, from the pairs of the visible tracks of this
          // answer in the files the viewer has (the ISRCs go in order, so the first pair in key order that has one wins)
          const reported = orNull(ownAttrs.get(`${isrc}|${upc}`)?.releaseTitle);
          const kept = releases[upc];
          if (!kept) releases[upc] = { upc, title: reported, version: null, releaseDate: null, labelName: null, trackCount: null };
          else if (kept.title === null && kept.labelName === null) kept.title = reported;
        }
        // the owner of a pseudonym as GET /splits and GET /participations give it: the resolved owner of the index
        for (const a of refs ?? []) artists[a.id] ??= { id: a.id, pseudonym: a.pseudonym, ownerId: read.index.get(a.id)?.ownerId ?? null };
      }
      return { tracks, releases, artists };
    },
  };
}
