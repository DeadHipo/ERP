import type { TrackView } from '@erp/shared/api-responses';
import { displayTitle, fallbackTitleOf } from '../lib/track-title';
import { EntityLink } from './EntityLink';

/**
 * An ISRC as a person reads it: a small cover, the title, «version · ISRC» in small print, all a link to the track
 * (P6). Nothing is computed: the fields come from the API.
 *
 * `track` (D-250) is the track of `useTracks`: the title is `displayTitle(track)`, without one the link reads the
 * ISRC (once, D-243). Until the track arrives (`undefined`), and for an ISRC the directory does not know (`null`),
 * `fallbackTitle` is shown as it is, else the ISRC; only P5 passes it (its rows are known before their tracks). A
 * `fallbackTitle` that is the ISRC of the row is no title (D-256, the rule of `displayTitle`).
 * The version is never cut from a title here: `baseTitle` is the server's (D-244).
 */
export function TrackName(props: { isrc: string; track?: TrackView | null; fallbackTitle?: string | null }) {
  const base = props.track ? displayTitle(props.track) : fallbackTitleOf(props.isrc, props.fallbackTitle);
  const version = props.track?.meta?.version ?? null;
  const coverUrl = props.track?.meta?.coverUrl ?? null;
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
