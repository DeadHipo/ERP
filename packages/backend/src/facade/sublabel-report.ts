import { monthOf, monthStart } from '../shared/dates';
import { Decimal, money, picoToDecimal, ZERO } from '../shared/money';
import type { LinksService, SublabelTermRow } from '../modules/links';
import { normalizeLabelString } from '../modules/labels';
import { calculate } from './calculation';
import type { FacadeContext } from './context';
import { pct } from './layers/exact';
import { csvText } from './payroll';
import { artistsByIsrc, readArtistLinks } from './track-artists';
import type { ArtistRef } from '@erp/shared/api-responses';
import { scoped } from './scope';

// The report of a sublabel by its terms (D-219): its tracks by month, the label share after the artists and the
// participations, its percent and its part. A read of the calculation as it is: `calculate()`, the layers and the
// balance do not change and do not read the terms. Each viewer sees only its own part (spec §9): no gross of a track,
// no artists' shares, nothing of ours. The money paid today still follows the sublabel rules: `currentAmount` is what
// those rules give the sublabel on the same units, so the two can be compared before the money is switched.

/** Why the part of a row waits; null = confirmed by an approved document. */
export type SublabelReportReason = 'no_document' | 'document_not_approved' | 'assumption' | 'no_split' | 'not_allocated';

const covers = (t: Pick<SublabelTermRow, 'validFrom' | 'validTo'>, day: string) =>
  t.validFrom <= day && (t.validTo === null || day < t.validTo);

interface Sums {
  labelShare: string;
  amount: string;
  confirmed: string;
  waiting: string;
  currentAmount: string;
}

interface Acc {
  isrc: string;
  month: string;
  term: SublabelTermRow;
  labelShare: Decimal;
  amount: Decimal;
  current: Decimal;
  noSplit: boolean;
  notAllocated: boolean;
}

export function sublabelReportApi(ctx: FacadeContext, m: { links: LinksService }) {
  const { db, labels, owners, splits, modules, sources } = ctx;
  const { links } = m;

  async function report(sublabelId: string, period: { from?: string; to?: string } = {}) {
    const sublabel = await labels.getSublabel(sublabelId);
    const terms = await db.snapshot(() => links.sublabelTerms({ sublabelId }));
    const isrcs = [...new Set(terms.map((t) => t.isrc))].sort();
    const empty = {
      sublabel,
      period: { from: period.from ?? null, to: period.to ?? null },
      rows: [] as ReturnType<typeof rowOf>[],
      months: [] as ({ month: string } & Sums)[],
      tracks: [] as ({ isrc: string; title: string | null; artists: ArtistRef[]; months: number } & Sums)[],
      artists: [] as ({ key: string; artists: ArtistRef[]; tracks: number; isrcs: string[] } & Sums)[],
      total: { labelShare: '0', amount: '0', confirmed: '0', waiting: '0', currentAmount: '0' },
    };
    if (isrcs.length === 0) return empty;
    const calc = await calculate(scoped(modules, { isrcs, from: period.from, to: period.to, publishingLines: false }));
    const docs = [...new Set(terms.map((t) => t.documentId).filter((d): d is string => d !== null))];
    const info = docs.length > 0 ? await owners.documentInfo(docs) : new Map<string, { status: string; kind: string }>();
    // the titles and the pseudonyms of the registry on each ISRC (D-166): split rows, participations, registry links
    const { tracks, artistsOf } = await db.snapshot(async () => {
      const tracks = await owners.listTracks({ isrcs });
      const [splitList, partList, { links, index }] = await Promise.all([
        splits.listSplits({ isrcs }),
        splits.listParticipations({ isrcs }),
        readArtistLinks(owners, tracks),
      ]);
      return { tracks, artistsOf: artistsByIsrc({ tracks, links, splits: splitList, participations: partList, index }) };
    });
    const titles = new Map<string, string>();
    for (const t of tracks) if (t.isrc && !titles.has(t.isrc)) titles.set(t.isrc, t.title);
    const artistsOfIsrc = (isrc: string): ArtistRef[] => artistsOf.get(isrc) ?? [];
    const byIsrc = new Map<string, SublabelTermRow[]>();
    for (const t of terms) byIsrc.set(t.isrc, [...(byIsrc.get(t.isrc) ?? []), t]);

    const acc = new Map<string, Acc>();
    for (const u of calc.units) {
      const term = byIsrc.get(u.isrc)?.find((t) => covers(t, monthStart(u.reportingMonth)));
      if (!term) continue;
      // the label share before the sublabel's carve: what remains plus what today's rule carved (no new multiplication)
      const carved = u.allocations.filter((a) => a.kind === 'sublabel').reduce((s, a) => s.add(a.amount), ZERO);
      const allocated = u.status === 'allocated';
      const base = allocated && u.labelShareCategory !== 'no_split' ? u.labelShare.add(carved) : ZERO;
      const current = u.sublabelId === sublabelId ? carved : ZERO;
      const key = `${u.isrc}|${u.reportingMonth}`;
      const a = acc.get(key) ?? {
        isrc: u.isrc,
        month: u.reportingMonth,
        term,
        labelShare: ZERO,
        amount: ZERO,
        current: ZERO,
        noSplit: false,
        notAllocated: false,
      };
      a.labelShare = a.labelShare.add(base);
      a.amount = a.amount.add(pct(base, new Decimal(term.percent)));
      a.current = a.current.add(current);
      if (u.status === 'no_split' || u.labelShareCategory === 'no_split') a.noSplit = true;
      else if (!allocated) a.notAllocated = true;
      acc.set(key, a);
    }

    function reasonOf(a: Acc): SublabelReportReason | null {
      if (a.noSplit) return 'no_split';
      if (a.notAllocated) return 'not_allocated';
      if (a.term.documentId === null) return 'no_document';
      const d = info.get(a.term.documentId);
      if (d?.kind === 'assumption') return 'assumption';
      return d?.status === 'approved' ? null : 'document_not_approved';
    }

    function rowOf(a: Acc) {
      const reason = reasonOf(a);
      return {
        isrc: a.isrc,
        title: titles.get(a.isrc) ?? null,
        artists: artistsOfIsrc(a.isrc),
        month: a.month,
        termId: a.term.id,
        percent: a.term.percent,
        documentId: a.term.documentId,
        labelShare: money(a.labelShare),
        amount: money(a.amount),
        status: reason === null ? ('confirmed' as const) : ('waiting' as const),
        reason,
        currentAmount: money(a.current),
      };
    }

    const sorted = [...acc.values()].sort((x, y) => (x.month === y.month ? (x.isrc < y.isrc ? -1 : 1) : x.month < y.month ? -1 : 1));
    const rows = sorted.map(rowOf);
    const sum = (list: Acc[]) => {
      const confirmed = list.filter((a) => reasonOf(a) === null).reduce((s, a) => s.add(a.amount), ZERO);
      const amount = list.reduce((s, a) => s.add(a.amount), ZERO);
      return {
        labelShare: money(list.reduce((s, a) => s.add(a.labelShare), ZERO)),
        amount: money(amount),
        confirmed: money(confirmed),
        waiting: money(amount.sub(confirmed)),
        currentAmount: money(list.reduce((s, a) => s.add(a.current), ZERO)),
      };
    };
    const months = [...new Set(sorted.map((a) => a.month))].map((month) => ({ month, ...sum(sorted.filter((a) => a.month === month)) }));
    const byTrack = new Map<string, Acc[]>();
    for (const a of sorted) byTrack.set(a.isrc, [...(byTrack.get(a.isrc) ?? []), a]);
    const trackList = [...byTrack.entries()]
      .map(([isrc, list]) => ({ isrc, title: titles.get(isrc) ?? null, artists: artistsOfIsrc(isrc), months: list.length, ...sum(list) }))
      .sort((x, y) => new Decimal(y.amount).cmp(new Decimal(x.amount)) || (x.isrc < y.isrc ? -1 : 1));
    // by artist: one group per set of pseudonyms of a track (a track of two artists is one group «A · B»), so the
    // groups add up to the total and nothing is counted twice; '' = no pseudonym in the registry
    const groups = new Map<string, { artists: ArtistRef[]; list: Acc[]; isrcs: Set<string> }>();
    for (const a of sorted) {
      const artists = artistsOfIsrc(a.isrc);
      const key = artists.map((x) => x.id).join('|');
      const g = groups.get(key) ?? groups.set(key, { artists, list: [], isrcs: new Set() }).get(key)!;
      g.list.push(a);
      g.isrcs.add(a.isrc);
    }
    const artistList = [...groups.entries()]
      .map(([key, g]) => ({ key, artists: g.artists, tracks: g.isrcs.size, isrcs: [...g.isrcs].sort(), ...sum(g.list) }))
      .sort((x, y) => new Decimal(y.amount).cmp(new Decimal(x.amount)) || x.key.localeCompare(y.key));
    return { ...empty, rows, months, tracks: trackList, artists: artistList, total: sum(sorted) };
  }

  return {
    /** The report of a sublabel by its terms: track × report month (D-219). */
    sublabelReport: report,

    /** The same report as one csv sheet (UTF-8 with BOM, `;`, every field quoted). */
    async sublabelReportCsv(sublabelId: string, period: { from?: string; to?: string } = {}) {
      const r = await report(sublabelId, period);
      const header = ['month', 'isrc', 'title', 'artists', 'label_share', 'percent', 'amount', 'status', 'reason'];
      const text = csvText(
        header,
        r.rows.map((x) => [x.month, x.isrc, x.title, x.artists.map((a) => a.pseudonym).join(', '), x.labelShare, x.percent, x.amount, x.status, x.reason]),
      );
      const span = `${period.from ?? 'start'}_${period.to ?? 'now'}`;
      return { fileName: `sublabel_${r.sublabel.name}_${span}.csv`, text };
    },

    /**
     * The hints of a month (D-219): the tracks whose Believe label string is an alias of a sublabel of the register (the
     * same id in `labels`) and that have no live term in force in that month, with their net of the month. A hint
     * only: the money never reads it.
     */
    async sublabelSuggestions(monthRaw: string) {
      const month = monthOf(monthStart(monthRaw));
      const day = monthStart(month);
      const [register, list] = await Promise.all([labels.listSublabels(), labels.listLabels()]);
      const names = new Map(register.map((s) => [s.id, s.name]));
      const sublabelOfAlias = new Map<string, string>();
      for (const l of list) if (names.has(l.id)) for (const a of l.aliases) sublabelOfAlias.set(normalizeLabelString(a), l.id);
      if (sublabelOfAlias.size === 0) return { month, groups: [] };
      const isrcs = await sources.isrcsOfLabelAliases([...sublabelOfAlias.keys()], normalizeLabelString);
      if (isrcs.length === 0) return { month, groups: [] };
      const units = await sources.units({ isrcs, from: month, to: month });
      const live = await links.sublabelTerms({ isrcs: [...new Set(units.map((u) => u.isrc))] });
      const covered = new Set(live.filter((t) => covers(t, day)).map((t) => t.isrc));
      const found = new Map<string, Map<string, { labelString: string; net: Decimal }>>();
      for (const u of units) {
        const sub = sublabelOfAlias.get(normalizeLabelString(u.labelName));
        if (!sub || !u.isrc || covered.has(u.isrc)) continue;
        const of = found.get(sub) ?? found.set(sub, new Map()).get(sub)!;
        const cur = of.get(u.isrc) ?? { labelString: u.labelName, net: ZERO };
        of.set(u.isrc, { labelString: cur.labelString, net: cur.net.add(picoToDecimal(u.netPico)) });
      }
      const allIsrcs = [...new Set([...found.values()].flatMap((m) => [...m.keys()]))];
      const titles = new Map<string, string>();
      if (allIsrcs.length > 0) for (const t of await owners.listTracks({ isrcs: allIsrcs })) if (t.isrc && !titles.has(t.isrc)) titles.set(t.isrc, t.title);
      const groups = [...found.entries()]
        .map(([sublabelId, items]) => {
          const list = [...items.entries()]
            .map(([isrc, x]) => ({ isrc, title: titles.get(isrc) ?? null, labelString: x.labelString, net: x.net }))
            .sort((a, b) => b.net.cmp(a.net) || (a.isrc < b.isrc ? -1 : 1));
          return {
            sublabelId,
            sublabelName: names.get(sublabelId) ?? sublabelId,
            net: money(list.reduce((s, x) => s.add(x.net), ZERO)),
            items: list.map((x) => ({ ...x, net: money(x.net) })),
          };
        })
        .sort((a, b) => a.sublabelName.localeCompare(b.sublabelName));
      return { month, groups };
    },
  };
}
