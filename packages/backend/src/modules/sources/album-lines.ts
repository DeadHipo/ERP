import type { SourceUnit } from './service';

/**
 * The lines of a release without an ISRC (a download of the whole album, D-209): the owner's decision on D-035. A unit
 * with a UPC and no ISRC is spread over the tracks of its release (the ISRCs seen with that UPC in the files of the same
 * label book) in proportion to what each track earned up to and including the unit's report month (cumulative net); the
 * share of a track is added to the track's unit of the same key (or becomes one). A release whose tracks earned a total
 * ≤ 0 up to that month is spread equally. A unit whose release has no known track stays as it is (C «без ISRC»).
 * Integers of pico (no rounding beyond 1e-12): each share is truncated, the rest goes to the track of the largest
 * |weight| (the first ISRC on a tie), so Σ shares = the unit's net exactly.
 */
export function spreadAlbumLines(units: SourceUnit[], tracks: readonly SourceUnit[]): SourceUnit[] {
  const albums = units.filter((u) => u.isrc === '' && u.upc !== '');
  if (albums.length === 0) return units;
  const book = (u: Pick<SourceUnit, 'upc' | 'labelId'>) => `${u.upc}|${u.labelId ?? ''}`;
  // per release book: per ISRC, its net per report month
  const byRelease = new Map<string, Map<string, Map<string, bigint>>>();
  for (const t of tracks) {
    if (t.isrc === '' || t.upc === '') continue;
    const r = byRelease.get(book(t)) ?? byRelease.set(book(t), new Map()).get(book(t));
    const m = r?.get(t.isrc) ?? r?.set(t.isrc, new Map()).get(t.isrc);
    m?.set(t.reportingMonth, (m.get(t.reportingMonth) ?? 0n) + t.netPico);
  }
  const keyOf = (u: SourceUnit) => [u.account, u.isrc, u.upc, u.reportingMonth, u.salesMonth, u.labelName, u.labelId ?? ''].join('|');
  const out = units.filter((u) => !(u.isrc === '' && u.upc !== '' && byRelease.has(book(u))));
  const at = new Map(out.map((u, i) => [keyOf(u), i]));
  for (const a of albums) {
    const release = byRelease.get(book(a));
    if (!release) continue;
    const isrcs = [...release.keys()].sort();
    const weights = isrcs.map((i) => [...(release.get(i) as Map<string, bigint>)].reduce((s, [m, v]) => (m <= a.reportingMonth ? s + v : s), 0n));
    const total = weights.reduce((s, w) => s + w, 0n);
    const shares = total > 0n ? weights.map((w) => (a.netPico * w) / total) : isrcs.map(() => a.netPico / BigInt(isrcs.length));
    const abs = (x: bigint) => (x < 0n ? -x : x);
    let largest = 0;
    if (total > 0n) weights.forEach((w, i) => (abs(w) > abs(weights[largest] as bigint) ? (largest = i) : undefined));
    shares[largest] = (shares[largest] as bigint) + a.netPico - shares.reduce((s, x) => s + x, 0n);
    isrcs.forEach((isrc, i) => {
      const share = shares[i] as bigint;
      if (share === 0n) return;
      const unit: SourceUnit = { ...a, isrc, netPico: share };
      const k = keyOf(unit);
      const j = at.get(k);
      if (j === undefined) {
        at.set(k, out.length);
        out.push(unit);
      } else out[j] = { ...(out[j] as SourceUnit), netPico: (out[j] as SourceUnit).netPico + share };
    });
  }
  return out;
}
