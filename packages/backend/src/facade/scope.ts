import type { SnapshotFilter } from '../modules/sources';
import type { Modules } from './calculation';

/**
 * The unit scope of a calculation (D-161): the facade narrows the Believe units `calculate()` reads to the ones an
 * answer can depend on. `calculate()` itself is untouched: it still reads `sources.snapshot()`, and the scope is a
 * sources service whose snapshot is narrowed. The allocation of a unit depends on the unit and the reference data
 * only (the layer context is built from PostgreSQL alone), so an answer made of a subset of units is byte for byte the
 * answer of the full calculation restricted to that subset. A scope is used only where every number of the answer is
 * such a restriction: one ISRC (track money, explain), one UPC (release), one account and month (track summary), a
 * period (the C queue), the ISRCs of advertising records. Balances, payables, the overview, the reconciliation and
 * the signals stay full calculations (D-012; the signals and `negativeRemainders` are counts over everything).
 *
 * `FACADE_SCOPE=off` disables every scope (the A/B switch of the comparison on real data and of `tests/scope.test.ts`).
 */
export type UnitScope = SnapshotFilter;

export const scopeEnabled = () => process.env.FACADE_SCOPE !== 'off';

export function scoped(modules: Modules, scope: UnitScope): Modules {
  if (!scopeEnabled()) return modules;
  const { sources } = modules;
  return {
    ...modules,
    sources: { ...sources, snapshot: (filter: SnapshotFilter = {}) => sources.snapshot({ ...filter, ...scope }) },
  };
}

/** The scope of a period filter: the month range on its basis (an empty filter is the full calculation). */
export const periodScope = (f: { from?: string; to?: string; basis?: 'report' | 'sales' }): UnitScope => ({
  ...(f.from ? { from: f.from } : {}),
  ...(f.to ? { to: f.to } : {}),
  ...(f.basis ? { basis: f.basis } : {}),
});
