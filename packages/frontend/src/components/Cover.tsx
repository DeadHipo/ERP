/**
 * The cover of a track or a release in a box of a fixed size: the box is always there, so a row or a header does not
 * move when the cover arrives, and stays an empty square when there is none (no metadata, or it names no cover).
 * `sm` is the 32 px square of the lists (`TrackName`); `md` and `lg` are the headers of P6 and P8.
 */
const SIZES = { sm: 'h-8 w-8 rounded', md: 'h-12 w-12 rounded-md', lg: 'h-20 w-20 rounded-lg' } as const;

export function Cover(props: { url: string | null | undefined; size?: keyof typeof SIZES; testid?: string }) {
  const box = `${SIZES[props.size ?? 'sm']} shrink-0`;
  return props.url ? (
    <img src={props.url} alt="" className={`${box} bg-default object-cover`} loading="lazy" data-testid={props.testid} />
  ) : (
    <span aria-hidden className={`${box} inline-block border border-border bg-default`} data-testid={props.testid ? `${props.testid}-empty` : undefined} />
  );
}
