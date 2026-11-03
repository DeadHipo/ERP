import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { API_OPERATIONS, operationKey } from '../src/api/operations';
import { buildOpenApiDocument } from '../src/api/openapi';
import { newFacade, TMP, writeB17, writeBelieve } from './helpers/fixtures';

// The API contract (operations list, response schemas, OpenAPI document) must match the real routes and the real
// responses. The scenario below calls every operation of the list once and parses its response with its schema.

const I1 = 'QZTST2600001';
const I2 = 'QZTST2600002';
const I3 = 'QZTST2600003';
const UPC = '1234567890123';

interface RouteLayer {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: RouteLayer[] };
}

/** All `METHOD /path` pairs of the Express routers mounted under /api/v1. */
function expressRoutes(app: Express): string[] {
  const out: string[] = [];
  const walk = (stack: RouteLayer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) out.push(`${m.toUpperCase()} ${layer.route.path}`);
      } else if (layer.handle?.stack) walk(layer.handle.stack);
    }
  };
  walk((app as unknown as { router: { stack: RouteLayer[] } }).router.stack);
  return out;
}

describe('API contract', () => {
  let app: Express;
  const covered = new Set<string>();
  beforeAll(async () => {
    const f = await newFacade();
    app = createApp(f, { tmpDir: join(TMP, 'contract-uploads') });
  });

  const OPERATOR = 'contract-test';
  let auditRows = 0;
  /** Every successful write leaves exactly one audit row, newest first, with the route template (R5, D-140). */
  async function expectOneAuditRow(method: string, template: string, params?: Record<string, string>) {
    const res = await request(app).get('/api/v1/audit').query({ limit: '500' }).expect(200);
    const items = res.body.items as {
      operator: string;
      method: string;
      route: string;
      entityIds: string[];
    }[];
    expect(items.length, `audit rows after ${method} ${template}`).toBe(auditRows + 1);
    auditRows = items.length;
    expect(items[0]).toMatchObject({ operator: OPERATOR, method: method.toUpperCase(), route: template });
    for (const id of Object.values(params ?? {})) expect(items[0]?.entityIds).toContain(id);
  }

  /** Calls an operation by its template path and checks status and response body against the contract. */
  async function call(
    method: 'get' | 'post' | 'patch',
    template: string,
    o: {
      params?: Record<string, string>;
      query?: Record<string, string>;
      body?: unknown;
      file?: { path: string; fileName: string };
    } = {},
  ) {
    const op = API_OPERATIONS.find((x) => x.method === method && x.path === template);
    if (!op) throw new Error(`Operation ${method} ${template} is not in the contract`);
    const url =
      '/api/v1' +
      template.replace(/:([A-Za-z]+)/g, (_m, n: string) => encodeURIComponent(o.params?.[n] ?? ''));
    let req = request(app)[method](url);
    if (method !== 'get') req = req.set('X-Operator', OPERATOR);
    if (o.query) req = req.query(o.query);
    if (o.file) req = req.attach('file', o.file.path, o.file.fileName);
    else if (o.body !== undefined) req = req.send(o.body as object);
    const res = await req;
    expect(res.status, `${operationKey(op)} -> ${JSON.stringify(res.body)}`).toBe(op.status ?? 200);
    const parsed = op.response.safeParse(res.body);
    expect(
      parsed.success ? null : parsed.error.issues,
      `${operationKey(op)} response does not fit its schema`,
    ).toBeNull();
    covered.add(operationKey(op));
    if (method !== 'get') await expectOneAuditRow(method, template, o.params);
    return res.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  it('every operation answers with a body that fits its schema', async () => {
    await call('get', '/health');

    // module 1
    const owner = await call('post', '/owners', { body: { name: 'Ivan Synthetic', kind: 'person' } });
    const other = await call('post', '/owners', { body: { name: 'Petr Synthetic', kind: 'person' } });
    await call('get', '/owners');
    const a1 = await call('post', '/artists', { body: { pseudonym: 'Synth One', ownerId: owner.id } });
    const a2 = await call('post', '/artists', { body: { pseudonym: 'Synth Two' } });
    await call('post', '/artists/:id/owner', { params: { id: a2.id }, body: { ownerId: other.id } });
    await call('get', '/artists');
    await call('get', '/artists/duplicates');
    await call('get', '/search', { query: { q: 'synth', kinds: 'owners,artists' } });
    await call('get', '/artists/:id', { params: { id: a1.id } });
    const t1 = await call('post', '/tracks', { body: { title: 'Track One', isrc: I1, upc: UPC } });
    await call('post', '/tracks', { body: { title: 'Track Two', isrc: I2, upc: UPC } });
    await call('post', '/tracks', { body: { title: 'Track Three', isrc: I3, upc: UPC } });
    await call('patch', '/tracks/:id', { params: { id: t1.id }, body: { isrc: I1, upc: UPC } });
    await call('get', '/tracks');
    const noted = await call('patch', '/tracks/:id', {
      params: { id: t1.id },
      body: { note: 'check the rights' },
    });
    expect(noted.note).toBe('check the rights');
    const assumption = await call('post', '/documents', {
      body: { kind: 'assumption', title: 'Council decision', requiresApproval: false },
    });

    const contractDoc = await call('post', '/documents', {
      body: { kind: 'contract', title: 'Contract', ownerId: owner.id, requiresApproval: true },
    });
    await call('post', '/documents/:id/attach', {
      params: { id: contractDoc.id },
      body: { fileRef: 'dummy://c.pdf' },
    });
    await call('post', '/documents/:id/approve', { params: { id: contractDoc.id }, body: {} });
    await call('post', '/contracts', {
      body: { ownerId: owner.id, documentId: contractDoc.id, artistIds: [a1.id] },
    });
    const appendix = await call('post', '/documents', {
      body: { kind: 'appendix', title: 'Appendix', fileRef: 'dummy://a.pdf', requiresApproval: false },
    });
    const buyoutDoc = await call('post', '/documents', {
      body: { kind: 'buyout', title: 'Buyout', fileRef: 'dummy://b.pdf', requiresApproval: false },
    });
    await call('get', '/documents', { query: { ownerId: owner.id } });
    const filtered = await call('get', '/documents', {
      query: { status: 'not_attached', kind: 'buyout', q: 'buy', limit: '5' },
    });
    expect(filtered).toEqual([]);

    // splits
    await call('post', '/splits', {
      body: {
        isrc: I1,
        validFrom: '2026-01-01',
        shares: [{ artistId: a1.id, percent: '50' }],
        documentId: appendix.id,
      },
    });
    await call('post', '/splits/change', {
      body: {
        isrc: I1,
        from: '2026-09-01',
        shares: [{ artistId: a1.id, percent: '40' }],
        documentId: appendix.id,
      },
    });
    const unconfirmed = await call('post', '/splits', {
      body: { isrc: I2, validFrom: '2026-01-01', shares: [{ artistId: a1.id, percent: '10' }] },
    });
    await call('post', '/splits/:id/confirm', {
      params: { id: unconfirmed.id },
      body: { documentId: appendix.id },
    });
    await call('post', '/splits/buyout', {
      body: { isrcs: [I2], sellerArtistId: a1.id, effectiveFrom: '2026-06-01', documentId: buyoutDoc.id },
    });
    await call('get', '/splits', { query: { isrc: I1 } });
    await call('get', '/splits', { query: { status: 'unconfirmed', limit: '1', offset: '0' } });
    await call('post', '/splits', {
      body: {
        isrc: I3,
        validFrom: '2026-01-15',
        shares: [{ artistId: a1.id, percent: '20', documentId: assumption.id }],
      },
    });

    // labels
    const own = await call('post', '/labels', { body: { name: 'Own Synthetic', kind: 'own' } });
    const sub = await call('post', '/labels', {
      body: { name: 'Sub Synthetic', kind: 'sublabel', ownLabelId: own.id },
    });
    await call('post', '/labels/:id/aliases', { params: { id: sub.id }, body: { alias: 'Sub Imprint' } });
    const rule = await call('post', '/labels/:id/rules', {
      params: { id: sub.id },
      body: { percent: '30', recipientArtistId: a2.id, validFrom: '2026-02-10', documentId: appendix.id },
    });
    expect(rule.validFrom).toBe('2026-02-01');
    const labelList = await call('get', '/labels');
    expect(
      (labelList as unknown as { rules: { recipientPseudonym: string }[] }[]).flatMap((l) => l.rules)[0]
        ?.recipientPseudonym,
    ).toBe('Synth Two');
    await call('post', '/labels/rules/:id/close', {
      params: { id: rule.id },
      body: { validTo: '2026-06-01' },
    });

    // participations
    const part = await call('post', '/participations', {
      body: {
        isrc: I1,
        artistId: a2.id,
        percent: '5',
        base: 'net',
        fundedFrom: 'top',
        validFrom: '2026-03-20',
        documentId: appendix.id,
      },
    });
    expect(part.validFrom).toBe('2026-03-01');
    const plist = await call('get', '/participations', { query: { isrc: I1 } });
    expect(plist.total).toBe(1);
    const ppage = await call('get', '/participations', { query: { limit: '1', offset: '1' } });
    expect(ppage.items).toEqual([]);
    await call('post', '/participations/:id/close', {
      params: { id: part.id },
      body: { validTo: '2026-09-01' },
    });

    // sources and publishing
    await call('post', '/sources/believe', {
      file: writeBelieve('2026-07', [
        { isrc: I1, upc: UPC, net: '300' },
        { isrc: I3, upc: UPC, net: '5' },
      ]),
    });
    await call('get', '/sources/files');
    await call('get', '/sources/lines', { query: { limit: '5' } });
    await call('get', '/sources/lines/facets');
    await call('post', '/publishing/b17', {
      file: await writeB17('Q22026', [{ writer: 'Writer Synthetic', title: 'Song', payable: 100 }]),
    });
    const writers = await call('get', '/publishing/writers');
    await call('post', '/publishing/writers/resolve');
    await call('post', '/publishing/writers/:norm/map', {
      params: { norm: (writers as unknown as { writerNorm: string }[])[0]?.writerNorm ?? '' },
      body: { ownerId: owner.id },
    });
    await call('post', '/publishing/terms', {
      body: { ownerId: owner.id, percent: '50', validFrom: '2026-01-01' },
    });
    const typed = await call('post', '/publishing/terms', {
      body: { ownerId: owner.id, percent: '60', validFrom: '2026-02-01', operationType: 'Performance' },
    });
    expect(typed.operationType).toBe('Performance');

    // views
    await call('get', '/owners/:id', { params: { id: owner.id } });
    await call('get', '/owners/:id/balance', {
      params: { id: owner.id },
      query: { from: '2026-07', to: '2026-07' },
    });
    await call('get', '/reconciliation', { query: { from: '2026-07', to: '2026-07' } });
    await call('get', '/signals');
    await call('get', '/overview', { query: { from: '2026-07', to: '2026-07' } });
    await call('get', '/queue/:reason', { params: { reason: 'split_unconfirmed' }, query: { limit: '10' } });
    await call('get', '/queue/:reason', {
      params: { reason: 'writer_unmapped' },
      query: { month: '2026-07' },
    });
    await call('get', '/tracks/:isrc/explain', { params: { isrc: I1 } });
    await call('get', '/owners/payables', { query: { from: '2026-07', to: '2026-07' } });
    await call('get', '/tracks/summary', { query: { month: '2026-07' } });
    await call('get', '/tracks/:isrc/money', { params: { isrc: I1 } });
    await call('get', '/tracks/:isrc/breakdown/:month', { params: { isrc: I1, month: '2026-07' } });
    await call('get', '/releases', { query: { q: UPC } });
    await call('get', '/releases/:upc', { params: { upc: UPC } });
    await call('get', '/documents/:id/uses', { params: { id: contractDoc.id } });

    // settlements
    const payout = await call('post', '/owners/:id/payouts', { params: { id: owner.id }, body: {} });
    await call('get', '/settlements/operations/:id/snapshot', { params: { id: payout.id } });
    await call('post', '/settlements/operations/:id/deferred', {
      params: { id: payout.id },
      body: { deferred: true },
    });
    await call('post', '/settlements/operations/:id/proof', {
      params: { id: payout.id },
      body: { fileRef: 'dummy://p.pdf' },
    });
    const deduction = await call('post', '/settlements/operations', {
      body: { direction: 'in', amount: '1.00', artistId: a1.id, date: '2026-08-01', comment: 'penalty' },
    });
    await call('post', '/settlements/operations/:id/deactivate', {
      params: { id: deduction.id },
      body: { reason: 'mistake' },
    });
    await call('post', '/settlements/operations/:id/return', {
      params: { id: payout.id },
      body: { fileRef: 'dummy://r.pdf', date: '2099-12-31', comment: 'bounced' },
    });
    await call('get', '/settlements/operations');
    const needing = await call('get', '/settlements/operations', {
      query: { ownerId: owner.id, meaning: 'payout', direction: 'out', needsProof: 'true', active: 'true', from: '2000-01-01', to: '2100-01-01' },
    });
    expect(Array.isArray(needing)).toBe(true);

    await call('post', '/owners/merge', {
      body: { fromId: other.id, intoId: owner.id, reason: 'same person' },
    });

    // the trail of one entity: the merge, newest first, with ids and no free text
    const trail = await call('get', '/audit', { query: { entityId: owner.id, limit: '3' } });
    expect(trail.items[0]).toMatchObject({ method: 'POST', route: '/owners/merge', operator: OPERATOR });
    expect(trail.items[0].entityIds).toEqual(expect.arrayContaining([other.id, owner.id]));
    expect(trail.items[0].summary.body).toEqual({ reason: 'same person' });
    expect(trail.items.length).toBeLessThanOrEqual(3);
  });

  it('a write without the X-Operator header is refused and leaves no trace', async () => {
    const before = await request(app).get('/api/v1/audit').query({ limit: '500' }).expect(200);
    for (const header of [undefined, '', '   ', 'x'.repeat(201)]) {
      let req = request(app).post('/api/v1/owners');
      if (header !== undefined) req = req.set('X-Operator', header);
      const res = await req.send({ name: 'No Operator Synthetic', kind: 'person' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatchObject({ code: 'operator_required', statusCode: 400 });
    }
    const after = await request(app).get('/api/v1/audit').query({ limit: '500' }).expect(200);
    expect(after.body.items.length).toBe(before.body.items.length);
    const owners = await request(app).get('/api/v1/owners').expect(200);
    expect(JSON.stringify(owners.body)).not.toContain('No Operator Synthetic');
  });

  it('the scenario touched every operation of the contract', async () => {
    const missing = API_OPERATIONS.map(operationKey).filter((k) => !covered.has(k));
    expect(missing).toEqual([]);
  });

  it('the contract lists exactly the routes Express has', async () => {
    const real = expressRoutes(app)
      .filter((r) => r !== 'GET /openapi.json')
      .sort();
    const documented = API_OPERATIONS.map(operationKey).sort();
    expect(real).toEqual(documented);
  });

  it('serves the OpenAPI document with every operation and the Swagger UI', async () => {
    const doc = await request(app).get('/api/v1/openapi.json').expect(200);
    expect(doc.body.openapi).toBe('3.1.0');
    const built = buildOpenApiDocument();
    const count = (d: { paths?: Record<string, object> }) =>
      Object.values(d.paths ?? {}).reduce((n: number, p) => n + Object.keys(p).length, 0);
    expect(count(doc.body)).toBe(API_OPERATIONS.length);
    expect(count(built)).toBe(API_OPERATIONS.length);
    expect(doc.body.paths['/owners/{id}/balance'].get.parameters.length).toBeGreaterThan(1);
    const header = (
      doc.body.paths['/owners'].post.parameters as { name: string; in: string; required: boolean }[]
    ).find((p) => p.in === 'header');
    expect(header).toMatchObject({ name: 'X-Operator', required: true });
    expect(doc.body.paths['/owners'].get.parameters ?? []).toEqual([]);
    const ui = await request(app).get('/api/v1/docs/').expect(200);
    expect(ui.text).toContain('swagger');
  });
});
