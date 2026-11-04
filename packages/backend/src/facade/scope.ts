import type { SnapshotFilter } from '../modules/sources';
import type { Modules } from './calculation';

/**
 * The unit scope of a calculation (D-161, D-162): the facade narrows what `calculate()` reads to what an answer can
 * depend on. `calculate()` itself is untouched: it still reads `sources.snapshot()`, `splits.index()`,
 * `owners.knownPairs()` and `publishing.snapshotForCalculation()`, and the scope is a modules object whose services
 * answer those calls narrowed. The allocation of a unit depends on the unit and the reference data of its ISRC only
 * (the layer context asks `splitAt(isrc)`, `participationsAt(isrc)` and the known pairs of the unit), so an answer
 * made of a subset of units is byte for byte the answer of the full calculation restricted to that subset. A scope
 * is used only where every number of the answer is such a restriction: one ISRC (track money, explain), one UPC
 * (release), an account and month or a list of ISRCs (track summary), a period (the C queue), the ISRCs of
 * advertising records. Balances, payables, the overview, the reconciliation and the signals stay full calculations
 * (D-012; the signals and `negativeRemainders` are counts over everything).
 *
 * - `isrcs` narrows the units and, with them, the split index and the known pairs to those ISRCs.
 * - `publishingLines: false` skips the B17 statement lines: for the answers that use only the master side
 *   (`calc.publishing` is then empty, never read).
 *
 * `FACADE_SCOPE=off` disables every scope (the A/B switch of the comparison on real data and of `tests/scope.test.ts`).
 */
export type UnitScope = SnapshotFilter & { publishingLines?: false };

export const scopeEnabled = () => process.env.FACADE_SCOPE !== 'off';

/** A service with some methods replaced; the rest are looked up on the original (a test proxy included). */
const over = <T extends object>(service: T, methods: Partial<T>): T => Object.assign(Object.create(service) as T, methods);

export function scoped(modules: Modules, scope: UnitScope): Modules {
  if (!scopeEnabled()) return modules;
  const { publishingLines, ...filter } = scope;
  const { sources, splits, owners, publishing } = modules;
  const isrcs = filter.isrcs;
  return {
    ...modules,
    sources: over(sources, { snapshot: (f: SnapshotFilter = {}) => sources.snapshot({ ...f, ...filter }) }),
    ...(isrcs
      ? {
          splits: over(splits, { index: () => splits.index({ isrcs }) }),
          owners: over(owners, { knownPairs: () => owners.knownPairs({ isrcs }) }),
        }
      : {}),
    ...(publishingLines === false
      ? { publishing: over(publishing, { snapshotForCalculation: () => publishing.snapshotForCalculation({ lines: false }) }) }
      : {}),
  };
}

/** The scope of a period filter: the month range on its basis (an empty filter is the full calculation). */
export const periodScope = (f: { from?: string; to?: string; basis?: 'report' | 'sales' }): UnitScope => ({
  ...(f.from ? { from: f.from } : {}),
  ...(f.to ? { to: f.to } : {}),
  ...(f.basis ? { basis: f.basis } : {}),
});
