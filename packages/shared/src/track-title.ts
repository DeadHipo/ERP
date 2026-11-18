/**
 * The title of a recording without its version tail (D-244): «Song - Slowed» with the version «Slowed» is «Song».
 *
 * The tail ` - <version>` is cut only when the version is not empty and the title ends with it; otherwise the title is
 * returned as it is. No title, an empty title and an empty rest are `null`. Nothing is trimmed or normalised: this is
 * a title for showing, not the `baseTitle` of `facade/pubv2-links.ts`, which normalises titles to match songs.
 */
export function baseTitleOf(title: string | null, version: string | null): string | null {
  if (title === null || title === '') return null;
  const tail = version ? ` - ${version}` : null;
  const base = tail !== null && title.endsWith(tail) ? title.slice(0, -tail.length) : title;
  return base === '' ? null : base;
}
