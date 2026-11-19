import { useMemo } from 'react';
import { queryOptions, useQueries, useQuery } from '@tanstack/react-query';
import type { ArtistView, ReleaseView, TrackView } from '@erp/shared/api-responses';
import * as api from '../client';
import { tracksLoader } from '../tracks-loader';
import { catalog } from '../catalog';
import { labelQuery } from '../../lib/label';
import { MONEY_QUERY } from './core';

// The track reads take the label view (D-168): `labelId` '' = «Все»; the key carries it, so a switch refetches.
export const trackKeys = {
  list: () => ['tracks', 'list'] as const,
  explain: (isrc: string) => ['tracks', 'explain', isrc] as const,
  summary: (account?: string, month?: string, labelId = '') => ['tracks', 'summary', account ?? null, month ?? null, labelId || null] as const,
  catalog: (labelId = '', current = false) => ['tracks', 'catalog', labelId || null, current ? 'current' : 'all'] as const,
  labels: (isrc: string) => ['tracks', 'labels', isrc] as const,
  meta: (isrc: string) => ['tracks', 'meta', isrc] as const,
  /** The track as it is shown (D-250): one cache entry per ISRC; `['tracks', 'view']` is every one of them. Not a money key. */
  view: (isrc: string) => ['tracks', 'view', isrc] as const,
  money: (isrc: string) => ['tracks', 'money', isrc] as const,
  breakdown: (isrc: string, month: string) => ['tracks', 'breakdown', isrc, month] as const,
  audit: (entityId: string) => ['audit', 'list', entityId] as const,
};

/** A track view is reused for ten minutes (D-250); a write that may change it invalidates it at once. */
const TRACK_VIEW_STALE_MS = 600_000;

export const trackQueries = {
  list: () => queryOptions({ queryKey: trackKeys.list(), queryFn: () => api.tracks.list() }),
  explain: (isrc: string) =>
    queryOptions({ queryKey: trackKeys.explain(isrc), queryFn: () => api.tracks.explain(isrc), ...MONEY_QUERY }),
  /** P5 with an account or month (the P1 drill-down): one calculation, all rows; the grid filters client-side (N5). */
  summary: (account?: string, month?: string, labelId = '') =>
    queryOptions({
      queryKey: trackKeys.summary(account, month, labelId),
      queryFn: () => catalog.trackSummary({ account, month, ...labelQuery(labelId) }),
      ...MONEY_QUERY,
    }),
  /** P5 (D-162): the rows without money (a reference list, no calculation); under a label the ISRCs of its units. */
  catalog: (labelId = '', current = false) =>
    queryOptions({
      queryKey: trackKeys.catalog(labelId, current),
      queryFn: () => catalog.trackCatalog({ ...labelQuery(labelId), ...(current ? { catalog: 'current' as const } : {}) }),
    }),
  /** The label history of the ISRC (D-172, P6): navigation, no money. */
  labels: (isrc: string) => queryOptions({ queryKey: trackKeys.labels(isrc), queryFn: () => api.tracks.labels(isrc), staleTime: 0 }),
  /** D-238: the metadata of a recording (a reference read, not money). */
  meta: (isrc: string) => queryOptions({ queryKey: trackKeys.meta(isrc), queryFn: () => api.tracks.meta(isrc), staleTime: 0 }),
  /**
   * The track as it is shown (D-250): asked through the batch loader, fresh for ten minutes. An ISRC the directory
   * does not know is `{ track: null, releases: {}, artists: {} }` (a `queryFn` may not answer `undefined`). Any write
   * that invalidates `reference` or `all` makes it stale: it is not a money key.
   */
  view: (isrc: string) => queryOptions({ queryKey: trackKeys.view(isrc), queryFn: () => tracksLoader.load(isrc), staleTime: TRACK_VIEW_STALE_MS }),
  /** P6: the one money call of the track card (N6). */
  money: (isrc: string) =>
    queryOptions({ queryKey: trackKeys.money(isrc), queryFn: () => catalog.trackMoney(isrc), ...MONEY_QUERY }),
  /** The breakdown of one month: ClickHouse rows only, no calculation (N7). */
  breakdown: (isrc: string, month: string) =>
    queryOptions({ queryKey: trackKeys.breakdown(isrc, month), queryFn: () => catalog.trackBreakdown(isrc, month) }),
  /** The audit trail of the ISRC (History tab). */
  audit: (entityId: string) =>
    queryOptions({ queryKey: trackKeys.audit(entityId), queryFn: () => catalog.audit({ entityId, limit: 200 }), staleTime: 0 }),
};

/**
 * The tracks of the ISRCs on the screen (D-250): one cache entry per ISRC, so only the ISRCs missing from the
 * cache are asked, and the asks of one frame (several tables of a page) go out as one `POST /tracks/query`. Pass only
 * the ISRCs that are shown. `track(isrc)` is `undefined` only while its answer is on the way, and `null` for an ISRC
 * the directory does not know and for an ask that failed; `release(upc)` and `artist(id)` give the records the arrived tracks name. The object changes only
 * when the data does, so a `useMemo` of columns may depend on it.
 */
const NO_TRACK = { track: null, releases: {}, artists: {} } as const;

export function useTracks(isrcs: readonly string[]) {
  const joined = isrcs.join(',');
  // the list by value: a new array of the same ISRCs is the same list
  const list = useMemo(() => [...new Set(joined === '' ? [] : joined.split(','))], [joined]);
  // `combine` results are structurally shared: the array keeps its identity while no entry changes
  // A failed ask is shown as an unknown track (the fallback look of the page: the ISRC, «—»), not as a load that never
  // ends, and without a toast; data seen before a failed refetch stays.
  const entries = useQueries({
    queries: list.map((isrc) => trackQueries.view(isrc)),
    combine: (results) => results.map((r) => r.data ?? (r.isError ? NO_TRACK : undefined)),
  });
  return useMemo(() => {
    const tracks = new Map<string, TrackView | null>();
    const releases = new Map<string, ReleaseView>();
    const artists = new Map<string, ArtistView>();
    list.forEach((isrc, i) => {
      const entry = entries[i];
      if (!entry) return;
      tracks.set(isrc, entry.track);
      for (const r of Object.values(entry.releases)) releases.set(r.upc, r);
      for (const a of Object.values(entry.artists)) artists.set(a.id, a);
    });
    return {
      track: (isrc: string): TrackView | null | undefined => tracks.get(isrc),
      release: (upc: string): ReleaseView | undefined => releases.get(upc),
      artist: (id: string): ArtistView | undefined => artists.get(id),
    };
  }, [list, entries]);
}

/**
 * The track of an ISRC as the cache has it (D-250), never asked from here: for a grid cell whose page asks the
 * shown rows with `useTracks` (P5). `undefined` until it arrives, `null` for an ISRC the directory does not know.
 */
export function useCachedTrack(isrc: string): TrackView | null | undefined {
  return useQuery({ ...trackQueries.view(isrc), enabled: false }).data?.track;
}
