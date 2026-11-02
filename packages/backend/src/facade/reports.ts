import { Decimal, ZERO } from '../shared/money';
import { inMonthRange } from '../shared/dates';
import { assertIsrc } from '../shared/identifiers';
import { calculate, reconcile, type PeriodFilter } from './calculation';
import type { FacadeContext } from './context';

export function reportsApi(ctx: FacadeContext) {
  const { owners, splits, sources, publishing, modules, balanceWithFiles } = ctx;
  const api = {
    /** Completeness check; A is also compared with the totals stored when each file was loaded. */
    async reconciliation(f: PeriodFilter = {}) {
      const calc = await calculate(modules);
      const rows = reconcile(calc, f);
      const believeTotals = new Map<string, Decimal>();
      const loadedIds = new Set(calc.believeFiles.map((x) => x.id));
      for (const file of await sources.listFiles()) {
        // only the files this calculation was made from, with the totals stored when each was loaded
        if (file.status !== 'loaded' || !loadedIds.has(file.id) || file.netTotal === null) continue;
        const k = `${file.account}|${file.reportingMonth}`;
        believeTotals.set(k, (believeTotals.get(k) ?? ZERO).add(file.netTotal));
      }
      // Alarm: our remainder has the opposite sign of the line (shares above 100); negative report lines alone are normal.
      const negativeRemainders = calc.units.filter(
        (u) => !u.net.isZero() && !u.labelShare.isZero() && u.labelShare.isNegative() !== u.net.isNegative(),
      ).length;
      return rows.map((r) => {
        const fileTotal =
          r.source === 'believe' && (f.basis ?? 'report') === 'report'
            ? (believeTotals.get(`${r.account}|${r.month}`) ?? null)
            : null;
        return {
          ...r,
          fileTotal,
          fileDiscrepancy: fileTotal ? r.A_received.sub(fileTotal) : null,
          negativeRemainders: r.source === 'believe' ? negativeRemainders : 0,
        };
      });
    },

    async ownerBalance(ownerId: string, f: PeriodFilter = {}) {
      return (await balanceWithFiles(ownerId, f)).balance;
    },

    /**
     * Signals for managers: pairs not in module 1 (with money), ISRCs without split, ambiguous writers; and from the
     * layers (D-127): shortfalls of carves (`unfunded`), unmapped label strings with their net, tracks with a note,
     * participations whose recipient has no owner, money under assumptions grouped by document.
     */
    async signals(f: PeriodFilter = {}) {
      const calc = await calculate(modules);
      const attrs = await sources.pairAttributes();
      const unknown = new Map<string, { isrc: string; upc: string; net: Decimal; months: Set<string> }>();
      const noSplit = new Map<string, Decimal>();
      const unmapped = new Map<string, Decimal>();
      const assumptions = new Map<
        string,
        { documentId: string | null; basis: string; amount: Decimal; isrcs: Set<string> }
      >();
      const unfunded: {
        isrc: string;
        upc: string;
        month: string;
        ruleId: string;
        missing: Decimal;
        why: string;
      }[] = [];
      const byRule = new Map<string, Decimal>();
      let noIsrc = ZERO;
      for (const u of calc.units) {
        if (!inMonthRange((f.basis ?? 'report') === 'sales' ? u.salesMonth : u.reportingMonth, f.from, f.to))
          continue;
        if (u.status === 'unknown_pair' || u.status === 'no_isrc') {
          const k = `${u.isrc}|${u.upc}`;
          const r = unknown.get(k) ?? { isrc: u.isrc, upc: u.upc, net: ZERO, months: new Set<string>() };
          r.net = r.net.add(u.net);
          r.months.add(u.reportingMonth);
          unknown.set(k, r);
          if (u.status === 'no_isrc') noIsrc = noIsrc.add(u.net);
          continue;
        }
        if (u.status === 'no_split') noSplit.set(u.isrc, (noSplit.get(u.isrc) ?? ZERO).add(u.net));
        if (u.labelShareCategory === 'label_unmapped')
          unmapped.set(u.labelName, (unmapped.get(u.labelName) ?? ZERO).add(u.net));
        unfunded.push(...u.shortfalls);
        for (const a of u.allocations) {
          byRule.set(a.ruleId, (byRule.get(a.ruleId) ?? ZERO).add(a.amount));
          if (a.reason !== 'assumption') continue;
          const k = `${a.documentId ?? ''}|${a.assumption}`;
          const r = assumptions.get(k) ?? {
            documentId: a.documentId,
            basis: a.assumption ?? 'document',
            amount: ZERO,
            isrcs: new Set<string>(),
          };
          r.amount = r.amount.add(a.amount);
          r.isrcs.add(u.isrc);
          assumptions.set(k, r);
        }
      }
      const unknownPairs = [...unknown.entries()]
        .map(([k, r]) => ({
          isrc: r.isrc,
          upc: r.upc,
          net: r.net,
          months: [...r.months].sort(),
          reportTitle: attrs.get(k)?.trackTitle || attrs.get(k)?.releaseTitle || '',
          reportArtist: attrs.get(k)?.artistName ?? '',
        }))
        .sort((a, b) => b.net.cmp(a.net));
      const { tracks, parts } = await modules.db.snapshot(async () => ({
        tracks: await owners.listTracks(),
        parts: await splits.listParticipations(),
      }));
      return {
        unallocated: {
          total: unknownPairs.reduce((s, p) => s.add(p.net), ZERO),
          withoutIsrc: noIsrc,
          pairs: unknownPairs,
        },
        isrcsWithoutSplit: [...noSplit.entries()]
          .map(([isrc, net]) => ({ isrc, net }))
          .sort((a, b) => b.net.cmp(a.net)),
        ambiguousWriters: (await publishing.listWriters()).filter((w) => w.resolution === 'ambiguous'),
        unfunded,
        labelUnmapped: [...unmapped.entries()]
          .map(([labelName, net]) => ({ labelName, net }))
          .sort((a, b) => b.net.cmp(a.net)),
        tracksWithNote: tracks
          .filter((t) => t.note)
          .map((t) => ({ trackId: t.id, isrc: t.isrc, upc: t.upc, title: t.title, note: t.note as string })),
        participantsWithoutOwner: parts
          .filter((p) => !calc.artistIndex.get(p.artistId)?.ownerId)
          .map((p) => ({
            participationId: p.id,
            isrc: p.isrc,
            artistId: p.artistId,
            pseudonym: calc.artistIndex.get(p.artistId)?.pseudonym ?? '?',
            fundedFrom: p.fundedFrom,
            amount: byRule.get(p.id) ?? ZERO,
          })),
        assumptions: [...assumptions.values()]
          .map((a) => ({
            documentId: a.documentId,
            basis: a.basis,
            amount: a.amount,
            isrcs: [...a.isrcs].sort(),
          }))
          .sort((a, b) => b.amount.abs().cmp(a.amount.abs())),
      };
    },

    /**
     * Explains one ISRC: split periods, participations, units with their allocations and the state after every
     * layer (10 §6), platform/country breakdown.
     */
    async explainTrack(isrcRaw: string) {
      const isrc = assertIsrc(isrcRaw);
      const calc = await calculate(modules, [], { traceIsrc: isrc });
      const units = calc.units
        .filter((u) => u.isrc === isrc)
        .map(({ layers, ...u }) => ({
          ...u,
          layers: (layers ?? []).map(({ layer, state }) => ({
            layer,
            status: state.status,
            ourLabelId: state.ourLabelId,
            ourLabelName: state.ourLabelName,
            rule: state.rule,
            scaledNet: state.scaledNet,
            labelShare: state.labelShare,
            labelShareCategory: state.labelShareCategory,
            allocations: state.rows,
            shortfalls: state.shortfalls,
          })),
        }));
      return {
        isrc,
        splits: await splits.listSplits({ isrc }),
        participations: await splits.listParticipations({ isrc }),
        units,
        breakdown: await sources.breakdown(isrc),
      };
    },
  };
  return api;
}
