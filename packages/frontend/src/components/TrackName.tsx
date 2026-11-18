import type { TrackView } from '@erp/shared/api-responses';
import { displayTitle } from '../lib/track-title';
import { EntityLink } from './EntityLink';

/** The metadata of a recording shown beside an ISRC (D-238, D-239): its title with the version and its cover. */
export interface TrackMetaLite {
  isrc: string;
  title: string | null;
  version: string | null;
  coverUrl: string | null;
}

/**
 * An ISRC as a person reads it: a small cover, the title, «version · ISRC» in small print, all a link to the track
 * (P6). Nothing is computed: the fields come from the API.
 *
 * `track` (D-250) is the track of `useTracks`: the title is `displayTitle(track)`, without one the link reads the
 * ISRC (once, D-243). Until the track arrives (`undefined`), and for an ISRC the directory does not know (`null`),
 * `fallbackTitle` is shown as it is, else the ISRC; only P5 passes it (its rows are known before their tracks).
 *
 * `meta` is the old way (D-239, D-242) of the pages not moved yet: the title of the lite meta with the version cut
 * here. It goes away with the last of them (T4.4).
 */
export function TrackName(props: { isrc: string; track?: TrackView | null; meta?: TrackMetaLite; fallbackTitle?: string | null }) {
  const m = props.meta;
  const legacyBase = m?.title && m.version && m.title.endsWith(` - ${m.version}`) ? m.title.slice(0, -(m.version.length + 3)) : (m?.title ?? props.fallbackTitle ?? null);
  const base = m ? legacyBase : props.track ? displayTitle(props.track) : props.fallbackTitle || null;
  const version = m ? m.version : (props.track?.meta?.version ?? null);
  const coverUrl = m ? m.coverUrl : (props.track?.meta?.coverUrl ?? null);
  return (
    <span className="inline-flex items-center gap-2" data-testid={`track-name-${props.isrc}`}>
      {coverUrl ? <img src={coverUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" /> : null}
      <span className="flex flex-col leading-tight">
        <EntityLink kind="isrc" id={props.isrc} label={base ?? props.isrc} />
        {/* without any title the link already reads the ISRC: it is not repeated under it */}
        {base !== null || version ? (
          <span className="text-xs text-muted">
            {version ? <span data-testid={`track-version-${props.isrc}`}>{version}</span> : null}
            {version && base !== null ? ' · ' : null}
            {base !== null ? props.isrc : null}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** The meta of a list by ISRC, for `TrackName`. */
export const metaByIsrc = (list: readonly TrackMetaLite[] | undefined) => new Map((list ?? []).map((m) => [m.isrc, m]));
