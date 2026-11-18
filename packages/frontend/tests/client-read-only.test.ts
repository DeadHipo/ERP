import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// A read sent as a POST (D-246): `call()` treats a `readOnly` operation as a GET: no `X-Operator`, even when the
// operator is known, and `X-Audit` is not read. A plain POST keeps both.

let operator = '';
vi.mock('../src/lib/operator', () => ({ getOperator: () => operator }));

const { ApiError, call, setAuditFailedHandler } = await import('../src/api/client');

const schema = z.object({ ok: z.boolean() });
const sent: { url: string; init: RequestInit }[] = [];
const auditFailed = vi.fn();

beforeEach(() => {
  operator = '';
  sent.length = 0;
  auditFailed.mockClear();
  setAuditFailedHandler(auditFailed);
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-Audit': 'failed' } }));
  });
});
afterEach(() => vi.unstubAllGlobals());

const headersOf = (i: number) => sent[i]?.init.headers as Record<string, string>;

describe('call() with a readOnly operation (D-246)', () => {
  it('needs no operator and sends no X-Operator; the body goes as JSON', async () => {
    await expect(call('POST', '/tracks/query', { body: { isrcs: ['QZTST2600001'] }, schema, readOnly: true })).resolves.toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('/api/v1/tracks/query');
    expect(sent[0]?.init.method).toBe('POST');
    expect(sent[0]?.init.body).toBe('{"isrcs":["QZTST2600001"]}');
    expect(headersOf(0)).toEqual({ 'Content-Type': 'application/json' });
  });

  it('sends no X-Operator even when the operator is known, and does not read X-Audit', async () => {
    operator = 'tester';
    await call('POST', '/tracks/query', { body: { isrcs: ['QZTST2600001'] }, schema, readOnly: true });
    expect(headersOf(0)).not.toHaveProperty('X-Operator');
    expect(auditFailed).not.toHaveBeenCalled();
  });

  it('a plain POST still needs the operator, sends it and reads X-Audit', async () => {
    const refused = call('POST', '/tracks', { body: {}, schema });
    await expect(refused).rejects.toBeInstanceOf(ApiError);
    await expect(refused).rejects.toMatchObject({ code: 'operator_required' });
    expect(sent).toHaveLength(0);
    operator = 'tester';
    await call('POST', '/tracks', { body: {}, schema });
    expect(headersOf(0)).toMatchObject({ 'X-Operator': 'tester' });
    expect(auditFailed).toHaveBeenCalledTimes(1);
  });

  it('a GET is as before: no operator, X-Audit not read', async () => {
    operator = 'tester';
    await call('GET', '/tracks', { schema });
    expect(headersOf(0)).toEqual({});
    expect(auditFailed).not.toHaveBeenCalled();
  });
});
