import { EntityLink } from './EntityLink';

/** The metadata of a recording shown beside an ISRC (D-238, D-239): its title with the version and its cover. */
export interface TrackMetaLite {
  isrc: string;
  title: string | null;
  version: string | null;
  coverUrl: string | null;
}

/**
 * An ISRC as a person reads it: a small cover, «title · version» from the track meta (our title when there is no
 * meta), the ISRC in small print, all a link to the track (P6). Nothing is computed: the fields come from the API.
 */
export function TrackName(props: { isrc: string; meta?: TrackMetaLite; fallbackTitle?: string | null }) {
  const m = props.meta;
  const base = m?.title && m.version && m.title.endsWith(` - ${m.version}`) ? m.title.slice(0, -(m.version.length + 3)) : (m?.title ?? props.fallbackTitle ?? null);
  return (
    <span className="inline-flex items-center gap-2" data-testid={`track-name-${props.isrc}`}>
      {m?.coverUrl ? <img src={m.coverUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" loading="lazy" /> : null}
      <span className="flex flex-col leading-tight">
        <EntityLink kind="isrc" id={props.isrc} label={base ?? props.isrc} />
        {/* without any title the link already reads the ISRC: it is not repeated under it */}
        {base !== null || m?.version ? (
          <span className="text-xs text-muted">
            {m?.version ? <span data-testid={`track-version-${props.isrc}`}>{m.version}</span> : null}
            {m?.version && base !== null ? ' · ' : null}
            {base !== null ? props.isrc : null}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** The meta of a list by ISRC, for `TrackName`. */
export const metaByIsrc = (list: readonly TrackMetaLite[] | undefined) => new Map((list ?? []).map((m) => [m.isrc, m]));
