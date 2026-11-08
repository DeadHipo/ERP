import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildOpenApiDocument, responseFieldsOf } from '../src/api/openapi';
import { API_OPERATIONS } from '../src/api/operations';

// The meaning of the fields (D-178): Claude sees the tools only through these texts, so every value a read answers or
// takes says what it is. Names that speak for themselves are listed here, once; a new field needs a `.describe()`.

const PLAIN = new Set([
  'id', 'name', 'title', 'fileName', 'sha256', 'createdAt', 'updatedAt', 'calculatedAt', 'comment', 'note', 'active',
  'deactivatedReason', 'month', 'date', 'from', 'to', 'amount', 'count', 'total', 'limit', 'offset', 'sort', 'dir', 'key',
  'keys', 'method', 'status', 'kind', 'version', 'believe', 'b17', 'breakdown',
]);
// a date says its format and its name says the rest; the bare text of `money` says nothing
const GENERIC = new Set(['Exact decimal string']);

const inner = (schema: z.ZodType): z.ZodType => {
  let s = schema;
  while (s instanceof z.ZodOptional || s instanceof z.ZodNullable || s instanceof z.ZodDefault) s = s.unwrap() as z.ZodType;
  return s;
};

/** The paths of the scalar fields without a meaning. */
function silent(schema: z.ZodType, path: string, seen = new Set<z.ZodType>()): string[] {
  const s = inner(schema);
  if (seen.has(s)) return [];
  if (s instanceof z.ZodArray) return silent(s.element as z.ZodType, `${path}[]`, seen);
  if (s instanceof z.ZodRecord) return silent(s.valueType as z.ZodType, `${path}{}`, seen);
  if (s instanceof z.ZodUnion) return (s.options as z.ZodType[]).flatMap((o) => silent(o, path, seen));
  if (!(s instanceof z.ZodObject)) return [];
  const next = new Set(seen).add(s);
  return Object.entries(s.shape as Record<string, z.ZodType>).flatMap(([name, field]) => {
    const u = inner(field);
    const container = u instanceof z.ZodObject || u instanceof z.ZodArray || u instanceof z.ZodRecord || u instanceof z.ZodUnion;
    if (container) return silent(field, `${path}.${name}`, next);
    const text = field.description ?? u.description;
    return PLAIN.has(name) || (text && !GENERIC.has(text)) ? [] : [`${path}.${name}`];
  });
}

const reads = API_OPERATIONS.filter(
  (o) => o.method === 'get' && (o.ability?.action === 'read' || o.ability?.action === 'read_money') && !['auth', 'orgs', 'users'].includes(o.tag),
);

describe('the meaning of the fields of the reads (D-178)', () => {
  it('every scalar of every answer says what it is', () => {
    expect(reads.length).toBeGreaterThan(40);
    expect(reads.flatMap((o) => silent(o.response, o.path))).toEqual([]);
  });

  it('every parameter of every read says what it is', () => {
    const missing = reads.flatMap((o) =>
      Object.entries((o.query?.shape ?? {}) as Record<string, z.ZodType>)
        .filter(([, field]) => {
          const text = field.description ?? inner(field).description;
          return !text || GENERIC.has(text);
        })
        .map(([name]) => `${o.path}?${name}`),
    );
    expect(missing).toEqual([]);
  });

  it('the description keeps the summary and, on a money answer, the meaning of its fields', () => {
    const doc = buildOpenApiDocument();
    const balance = doc.paths?.['/owners/{id}/balance']?.get?.description ?? '';
    expect(balance).toContain('Owner balance');
    expect(balance).toContain('- total.payable: earned − recouped');
    expect(balance).toContain('- period.received: A of the period');
    const owners = doc.paths?.['/owners']?.get?.description ?? '';
    expect(owners).not.toContain('Response fields');
    expect(owners.length).toBeGreaterThan(0);
  });

  it('the fields are read through optional and nullable, two levels deep', () => {
    const schema = z.object({ a: z.object({ b: z.string().describe('B'), c: z.object({ d: z.string().describe('D') }) }).nullable().describe('A') });
    expect(responseFieldsOf(schema)).toEqual(['- a: A', '- a.b: B']);
  });
});
