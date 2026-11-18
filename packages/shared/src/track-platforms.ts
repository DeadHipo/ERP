/**
 * The platforms of the metadata of a recording (D-238). The database keeps text; the API accepts only these. A new
 * platform is one line here (and its Russian name in the frontend dictionary).
 */
export const TRACK_PLATFORMS = [
  'spotify',
  'apple_music',
  'youtube',
  'youtube_music',
  'deezer',
  'amazon_music',
  'tiktok',
  'yandex_music',
  'vk_music',
  'boom',
  'soundcloud',
  'other',
] as const;
export type TrackPlatform = (typeof TRACK_PLATFORMS)[number];

/** The state of a platform entry: found, looked for and not found, or the lookup failed. */
export const TRACK_PLATFORM_STATUSES = ['found', 'not_found', 'error'] as const;
export type TrackPlatformStatus = (typeof TRACK_PLATFORM_STATUSES)[number];
