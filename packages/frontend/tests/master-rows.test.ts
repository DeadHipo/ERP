import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasterRows } from '@erp/shared/api-responses';
import type { MasterQueryBody } from '@erp/shared/api-schemas';
import { MONEY_KEYS, MONEY_QUERY, isMoneyKey } from '../src/api/queries/core';
import { masterKeys, masterQueries } from '../src/api/queries/money';

// The master money as rows (D-251, R2′): the key of `useMasterRows` is a money key, and `catalog.masterRows` is a
// read sent as a POST: the label only in the query, the body as asked, no `X-Operator`. `fetch` is replaced: the
// function runs over the real client.

let operator = '';
vi.mock('../src/lib/operator', () => ({ getOperator: () => operator }));

const { catalog } = await import('../src/api/catalog');
const { setAuditFailedHandler } = await import('../src/api/client');
const auditFailed = vi.fn();
setAuditFailedHandler(auditFailed);

const LABEL = '00000000-0000-4000-8000-0000000000aa';
const zero: MasterRows['totals'] = { net: '0', B: '0', C: '0', ours: '0', cByReason: {} };
const sent: { url: string; init: RequestInit }[] = [];
let answer: unknown;

beforeEach(() => {
  operator = '';
  sent.length = 0;
  auditFailed.mockClear();
  answer = { rows: [], totals: zero, calculatedAt: '2026-01-01T00:00:00.000Z' } satisfies MasterRows;
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Audit': 'failed' } }));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('the key of the master rows (D-251)', () => {
  const scope = { kind: 'release', upc: '0000000000017' } as const;

  it('[money, master] is in MONEY_KEYS', () => {
    expect(MONEY_KEYS.some(([domain, name]) => domain === 'money' && name === 'master')).toBe(true);
  });

  it('is a money key that carries the label, the scope, the grain and the period', () => {
    const key = masterKeys.rows(LABEL, scope, 'isrc', { from: '2026-01' });
    expect(key).toEqual(['money', 'master', LABEL, scope, 'isrc', { from: '2026-01', to: null }]);
    expect(isMoneyKey(key)).toBe(true);
    expect(isMoneyKey(masterKeys.rows('', { kind: 'isrcs' }, 'isrc,month'))).toBe(true);
  });

  it('differs by the label, the scope, the grain and the period; «Все» is null', () => {
    const base = JSON.stringify(masterKeys.rows(LABEL, scope, 'isrc'));
    expect(masterKeys.rows('', scope, 'isrc')[2]).toBeNull();
    expect(JSON.stringify(masterKeys.rows('', scope, 'isrc'))).not.toBe(base);
    expect(JSON.stringify(masterKeys.rows(LABEL, { kind: 'release', upc: '0000000000024' }, 'isrc'))).not.toBe(base);
    expect(JSON.stringify(masterKeys.rows(LABEL, scope, 'month'))).not.toBe(base);
    expect(JSON.stringify(masterKeys.rows(LABEL, scope, 'isrc', { to: '2026-03' }))).not.toBe(base);
    // no period and an empty period are the same query
    expect(JSON.stringify(masterKeys.rows(LABEL, scope, 'isrc', {}))).toBe(base);
  });

  it('the query is never fresh, like every money query', () => {
    const options = masterQueries.rows(LABEL, scope, 'month');
    expect(options.staleTime).toBe(MONEY_QUERY.staleTime);
    expect(options.staleTime).toBe(0);
    expect(options.queryKey).toEqual(masterKeys.rows(LABEL, scope, 'month'));
  });

  it('the query function sends the scope, the grain and the period under the label', async () => {
    const options = masterQueries.rows(LABEL, scope, 'month', { from: '2026-01', to: '2026-03' });
    await (options.queryFn as () => Promise<MasterRows>)();
    expect(sent[0]?.url).toBe(`/api/v1/money/master/query?label=${LABEL}`);
    expect(JSON.parse(sent[0]?.init.body as string)).toEqual({ scope, grain: 'month', period: { from: '2026-01', to: '2026-03' } });
    await (masterQueries.rows('', scope, 'isrc', {}).queryFn as () => Promise<MasterRows>)();
    expect(sent[1]?.url).toBe('/api/v1/money/master/query');
    expect(JSON.parse(sent[1]?.init.body as string)).toEqual({ scope, grain: 'isrc' });
  });
});

describe('catalog.masterRows (D-251)', () => {
  const body: MasterQueryBody = { scope: { kind: 'isrcs', isrcs: ['QZTST2600001', 'QZTST2600002'] }, grain: 'isrc' };

  it('is a POST with ?label= and the body, without X-Operator, and X-Audit is not read', async () => {
    operator = 'tester';
    await expect(catalog.masterRows(body, LABEL)).resolves.toEqual(answer);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`/api/v1/money/master/query?label=${LABEL}`);
    expect(sent[0]?.init.method).toBe('POST');
    expect(sent[0]?.init.body).toBe(JSON.stringify(body));
    expect(sent[0]?.init.headers).toEqual({ 'Content-Type': 'application/json' });
    // the answer carries `X-Audit: failed`: a read has no audit record, so the handler is never called
    expect(auditFailed).not.toHaveBeenCalled();
  });

  it('needs no operator; under «Все» the query has no label, and the body never carries one', async () => {
    await catalog.masterRows(body);
    expect(sent[0]?.url).toBe('/api/v1/money/master/query');
    expect(sent[0]?.init.body).not.toContain('label');
  });

  it('refuses an answer that is not the contract', async () => {
    answer = { rows: [{ sums: { ...zero, net: 1 } }], totals: zero, calculatedAt: '2026-01-01T00:00:00.000Z' };
    await expect(catalog.masterRows(body, LABEL)).rejects.toMatchObject({ code: 'contract_mismatch' });
  });
});
