import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_OPERATIONS } from '../../backend/src/api/operations';
import { routeLabel } from '../src/components/AuditTable';
import { ru } from '../src/i18n/ru';
import { compareDecimal } from '../src/lib/money';
import { monthRowId, type Month } from '../src/pages/catalog/track/types';

// Unit tests of the stage 5 helpers (D-151): decimal text order, the month row id, the audit route labels and the
// publishing resolution labels.

describe('compareDecimal', () => {
  const lt: [string, string][] = [
    ['-5', '3'],
    ['-10', '-2'],
    ['9', '10'],
    ['999999999999', '1000000000000'],
    ['1.5', '1.55'],
    ['0.000000000001', '0.00000000001'],
    ['-0.5', '0'],
    ['-0.55', '-0.5'],
  ];
  it.each(lt)('%s < %s', (a, b) => {
    expect(compareDecimal(a, b)).toBe(-1);
    expect(compareDecimal(b, a)).toBe(1);
  });
  it.each([
    ['1', '1'],
    ['1.0', '1'],
    ['1.50', '1.5'],
    ['-2.5', '-2.50'],
    ['0', '0.000'],
  ])('%s = %s', (a, b) => {
    expect(compareDecimal(a, b)).toBe(0);
  });
  it('treats a negative zero as zero', () => {
    expect(compareDecimal('-0', '0')).toBe(0);
    expect(compareDecimal('-0.00', '0')).toBe(0);
    expect(compareDecimal('-0', '0.001')).toBe(-1);
  });
  it('sorts empty values first', () => {
    expect(compareDecimal(null, '0')).toBe(-1);
    expect(compareDecimal('-5', undefined)).toBe(1);
    expect(compareDecimal('', null)).toBe(0);
  });
  it('orders a list by value, not as text', () => {
    const sorted = ['10', '-3', '2.5', '-30', '0', '100'].sort(compareDecimal);
    expect(sorted).toEqual(['-30', '-3', '0', '2.5', '10', '100']);
  });
});

describe('monthRowId', () => {
  const base = { account: 'A1', upc: '123', reportingMonth: '2026-03', salesMonth: '2026-01', labelName: 'L' } as Month;
  it('differs for two rows that differ only by the sales month', () => {
    expect(monthRowId(base)).not.toBe(monthRowId({ ...base, salesMonth: '2026-02' }));
  });
  it('differs by label string, account, UPC and report month, and is stable', () => {
    const ids = new Set([
      monthRowId(base),
      monthRowId({ ...base, labelName: 'M' }),
      monthRowId({ ...base, account: 'A2' }),
      monthRowId({ ...base, upc: '124' }),
      monthRowId({ ...base, reportingMonth: '2026-04' }),
    ]);
    expect(ids.size).toBe(5);
    expect(monthRowId({ ...base })).toBe(monthRowId(base));
  });
});

describe('routeLabel (audit table)', () => {
  const writes = API_OPERATIONS.filter((o) => o.method !== 'get');
  it('has a Russian label for every write route template of the API', () => {
    expect(writes.length).toBeGreaterThan(20);
    const missing = writes
      .map((o) => ({ method: o.method.toUpperCase(), path: o.path }))
      .filter((o) => !Object.hasOwn(ru.audit.routes, `${o.method} ${o.path}`))
      .map((o) => `${o.method} ${o.path}`);
    expect(missing).toEqual([]);
  });
  it('labels in Cyrillic and falls back to the template for an unknown route', () => {
    for (const o of writes) expect(routeLabel(o.method.toUpperCase(), o.path)).toMatch(/[а-яё]/i);
    expect(routeLabel('POST', '/nope')).toBe('POST /nope');
  });
});

describe('publishing resolution labels', () => {
  const labels = ru.reference.publishing.resolution as Record<string, string>;
  const backend = (p: string) => readFileSync(new URL(`../../backend/src/${p}`, import.meta.url), 'utf8');
  const emitted = new Set<string>(['unmapped']); // the SQL default of a new writer (repository.ts)
  const service = backend('modules/publishing/service.ts');
  const union = /resolution: ((?:'[a-z_]+'(?: \| )?)+),/.exec(service)?.[1] ?? '';
  for (const m of union.matchAll(/'([a-z_]+)'/g)) emitted.add(m[1] as string);
  for (const m of service.matchAll(/setWriterResolution\(\w+, '([a-z_]+)'\)/g)) emitted.add(m[1] as string);
  for (const m of backend('facade/sources.ts').matchAll(/mapWriter\([^;]*?'([a-z_]+)'\)/g)) emitted.add(m[1] as string);
  emitted.add('merged'); // repository.ts: merge of owners

  it('found the values the backend emits', () => {
    expect([...emitted].sort()).toEqual(['ambiguous', 'created_waiting_documents', 'external', 'manual', 'matched', 'merged', 'unmapped']);
  });
  it('has a Russian label for each', () => {
    for (const v of emitted) expect(labels[v], v).toMatch(/[а-яё]/i);
  });
});
