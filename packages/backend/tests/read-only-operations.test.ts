import { describe, expect, it } from 'vitest';
import { MCP_OPERATIONS } from '../src/api/mcp';
import { buildOpenApiDocument, readsWithToken } from '../src/api/openapi';
import { API_OPERATIONS, needsOperator, operationKey, type ApiOperation } from '../src/api/operations';

// The reads sent as a POST (D-246): the one exception to «every POST is a write» (D-140). The list is FROZEN: an
// operation joins it only with the plan (`docs/идеи/выдача_денег_и_треков/план.md` §4.3), never to spare a write its
// operator or its audit row.

const READ_ONLY = ['POST /tracks/query', 'POST /money/master/query']; // D-248: + the master money as rows

describe('the reads sent as a POST (D-246)', () => {
  const readOnly = API_OPERATIONS.filter((o) => o.readOnly);

  it('the frozen list names exactly the readOnly operations', () => {
    expect(readOnly.map(operationKey).sort()).toEqual([...READ_ONLY].sort());
  });

  it('each is a POST of an organization whose right is read / read_money, with a described body', () => {
    for (const o of readOnly) {
      expect([o.method, o.access], operationKey(o)).toEqual(['post', 'org']);
      expect(['read', 'read_money'], operationKey(o)).toContain(o.ability?.action);
      expect(o.body, `${operationKey(o)} body`).toBeDefined();
      // neither an upload nor a write with a preview nor a creation
      expect([o.upload, o.preview, o.status], operationKey(o)).toEqual([undefined, undefined, undefined]);
    }
  });

  it('the type refuses readOnly on a write and on a GET', () => {
    const base = { path: '/x', tag: 'x', summary: 'x', response: API_OPERATIONS[0]!.response, access: 'org' } as const;
    const fine: ApiOperation = { ...base, method: 'post', readOnly: true, ability: { action: 'read_money', subject: 'tracks', scope: 'label' } };
    // @ts-expect-error a write is never readOnly
    const write: ApiOperation = { ...base, method: 'post', readOnly: true, ability: { action: 'write', subject: 'tracks', scope: 'org' } };
    // @ts-expect-error a GET needs no mark
    const get: ApiOperation = { ...base, method: 'get', readOnly: true, ability: { action: 'read', subject: 'tracks', scope: 'org' } };
    expect([fine.readOnly, write.readOnly, get.readOnly]).toEqual([true, true, true]);
  });

  it('needs no operator: no X-Operator in the contract; every other non-public POST / PATCH still needs it', () => {
    const doc = buildOpenApiDocument();
    for (const o of API_OPERATIONS) {
      const expected = o.method !== 'get' && o.access !== 'public' && !READ_ONLY.includes(operationKey(o));
      expect(needsOperator(o), operationKey(o)).toBe(expected);
      const p = (doc.paths?.[o.path.replace(/:([A-Za-z]+)/g, '{$1}')] as Record<string, { parameters?: { name: string; in: string }[] }> | undefined)?.[o.method];
      expect((p?.parameters ?? []).some((x) => x.in === 'header' && x.name === 'X-Operator'), `${operationKey(o)} X-Operator`).toBe(expected);
    }
  });

  it('the read token may call it, as the GETs it stands for; it is not an MCP tool (MCP takes only GET)', () => {
    for (const o of readOnly) {
      expect(readsWithToken(o), operationKey(o)).toBe(true);
      expect(MCP_OPERATIONS.includes(o), operationKey(o)).toBe(false);
    }
    expect(MCP_OPERATIONS.every((o) => o.method === 'get')).toBe(true);
  });
});
