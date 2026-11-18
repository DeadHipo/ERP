import type { TrackView } from '@erp/shared/api-responses';

/**
 * The title a track is shown under (D-250), the one place that chooses it: the title of the meta without its
 * version tail (`baseTitle`, cut by the server, D-244), else our catalog title, else the title of the reports;
 * `null` = the track has none (the caller shows the ISRC, once, D-243).
 */
export function displayTitle(track: TrackView | null | undefined): string | null {
  return track?.meta?.baseTitle ?? track?.catalogTitle ?? track?.reportTitle ?? null;
}
