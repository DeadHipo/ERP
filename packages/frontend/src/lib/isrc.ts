/** The longest string `POST /tracks/query` takes as one ISRC (`tracksQueryBody`), counted before the normalisation. */
const MAX_RAW = 32;

/**
 * The ISRC of a string as the server keys it (D-250): no dashes or spaces, upper case, and the format of the
 * backend's `assertIsrc` (two letters, three alphanumerics, seven digits); `null` = the server would refuse the string
 * (400 for the whole request). Report ISRCs are only normalised, never checked, so a screen can hold such a string.
 */
export function isrcKey(raw: string): string | null {
  if (raw.length > MAX_RAW) return null;
  const isrc = raw.replace(/[-\s]/g, '').toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc) ? isrc : null;
}
