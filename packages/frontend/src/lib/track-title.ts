import type { TrackView } from '@erp/shared/api-responses';
import { isrcKey } from './isrc';

/**
 * The title a track is shown under (D-250), the one place that chooses it: the title of the meta without its
 * version tail (`baseTitle`, cut by the server, D-244), else our catalog title, else the title of the reports;
 * `null` = the track has none (the caller shows the ISRC, once, D-243). A title that is the ISRC of the track itself
 * (the catalog title of a track registered without a name; compared as ISRC keys: trimmed, no dashes, any case) is
 * no title (D-254): the choice goes on to the next one, so the ISRC is never shown twice.
 */
export function displayTitle(track: TrackView | null | undefined): string | null {
  if (!track) return null;
  const own = isrcKey(track.isrc) ?? track.isrc.trim().toUpperCase();
  const isOwnIsrc = (title: string) => (isrcKey(title.trim()) ?? title.trim().toUpperCase()) === own;
  return [track.meta?.baseTitle, track.catalogTitle, track.reportTitle].find((title) => title != null && !isOwnIsrc(title)) ?? null;
}

/**
 * The text a grid sorts and filters a track column by (D-254): «title · version · ISRC», the parts the cell shows
 * (`TrackName`); only the ISRC until the track arrives and for a track without a title.
 */
export function trackText(isrc: string, track: TrackView | null | undefined): string {
  return [displayTitle(track), track?.meta?.version, isrc].filter(Boolean).join(' · ');
}
