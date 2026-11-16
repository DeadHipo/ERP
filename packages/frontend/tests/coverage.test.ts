import { describe, expect, it } from 'vitest';
import { API_OPERATIONS, operationKey } from '../../backend/src/api/operations';
import { OPERATION_COVERAGE, PAGES_WITHOUT_OPERATIONS } from '../src/api/coverage';
import { ROUTES } from '../src/routes/paths';

// The completeness guard: every operation of the API has a screen or a documented refusal.
const keys = API_OPERATIONS.map(operationKey);
const entries: [string, { page: string; route: string; note?: string } | { refusal: string }][] = Object.entries(OPERATION_COVERAGE);
const withPage = entries.flatMap(([key, e]) => ('page' in e ? [{ key, ...e }] : []));

describe('operation coverage', () => {
  it('has an entry for every operation of operations.ts and nothing else', () => {
    expect(keys.length).toBeGreaterThan(50);
    expect(Object.keys(OPERATION_COVERAGE).sort()).toEqual([...keys].sort());
  });

  it('points every page entry at a route that exists', () => {
    const bad = withPage.filter((e) => !ROUTES.includes(e.route)).map((e) => `${e.key} -> ${e.route}`);
    expect(bad).toEqual([]);
  });

  it('uses only page ids P1..P35 or shell', () => {
    const bad = withPage.filter((e) => e.page !== 'shell' && !/^P([1-9]|1\d|2\d|3[0-5])$/.test(e.page)).map((e) => `${e.key}: ${e.page}`);
    expect(bad).toEqual([]);
  });

  it('covers every page P1..P30 at least once, except the documented ones', () => {
    const covered = new Set(withPage.map((e) => e.page));
    const missing = Array.from({ length: 30 }, (_, i) => `P${i + 1}`).filter((p) => !covered.has(p) && !(p in PAGES_WITHOUT_OPERATIONS));
    expect(missing).toEqual([]);
    for (const p of Object.keys(PAGES_WITHOUT_OPERATIONS)) expect(covered.has(p), `${p} has operations after all`).toBe(false);
  });

  it('gives every refusal a reason', () => {
    const refusals = entries.flatMap(([key, e]) => ('refusal' in e ? [{ key, reason: e.refusal }] : []));
    // D-218: the eight sublabel operations wait for their page (step 4 of the sublabels plan), which removes them from this list
    const SUBLABELS_UNTIL_STEP_4 = [
      'GET /sublabels',
      'GET /sublabels/terms',
      'PATCH /sublabels/:id',
      'POST /sublabels',
      'POST /sublabels/:id/terms',
      'POST /sublabels/terms/:id/cancel',
      'POST /sublabels/terms/:id/close',
      'POST /sublabels/terms/document',
      'GET /sublabels/:id/report',
      'GET /sublabels/suggestions',
    ];
    expect(refusals.map((r) => r.key).sort()).toEqual(['GET /health', 'GET /reconciliation', 'GET /tracks/:isrc/explain', ...SUBLABELS_UNTIL_STEP_4].sort());
    for (const r of refusals) expect(r.reason.length).toBeGreaterThan(15);
  });
});
