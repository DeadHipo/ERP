import { describe, expect, it, vi } from 'vitest';
import { possibleDuplicateDetailsSchema } from '@erp/shared/api-responses';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { newFacade, TMP } from './helpers/fixtures';
import { writer } from './helpers/writer';

// The operator's trail (D-140): the audit module, the facade methods, the API hook.

describe('audit module and facade', () => {
  it('records an action and lists it by entity and as recent, newest first', async () => {
    const f = await newFacade();
    const a = await f.recordAction({
      operator: ' Operator One ',
      method: 'post',
      route: '/documents/:id/approve',
      entityIds: ['doc-1', 'owner-1', 'doc-1'],
      summary: { params: { id: 'doc-1' } },
    });
    expect(a).toMatchObject({ operator: 'Operator One', method: 'POST', entityIds: ['doc-1', 'owner-1'] });
    expect(new Date(a.at).toISOString()).toBe(a.at);
    const b = await f.recordAction({
      operator: 'Operator Two',
      method: 'PATCH',
      route: '/tracks/:id',
      entityIds: ['owner-1'],
      summary: {},
    });
    expect((await f.auditOf('doc-1')).map((x) => x.id)).toEqual([a.id]);
    expect((await f.auditOf('owner-1')).map((x) => x.id)).toEqual([b.id, a.id]);
    expect((await f.auditOf('owner-1', 1)).map((x) => x.id)).toEqual([b.id]);
    expect(await f.auditOf('nobody')).toEqual([]);
    expect((await f.recentActions(10)).map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it('refuses an empty operator', async () => {
    const f = await newFacade();
    await expect(
      f.recordAction({ operator: '  ', method: 'POST', route: '/x', entityIds: [], summary: {} }),
    ).rejects.toMatchObject({ code: 'operator_required' });
  });
});

describe('operator header hook', () => {
  async function setup() {
    const f = await newFacade();
    return { f, app: createApp(f, { tmpDir: join(TMP, 'audit-uploads') }) };
  }

  it('refuses a write without the header and records one row with it', async () => {
    const { f, app } = await setup();
    const refused = await writer(app, 'x').post('/api/v1/owners').set('X-Operator', '').send({ name: 'A', kind: 'person' });
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({
      error: { code: 'operator_required', message: 'X-Operator header is required for writes', statusCode: 400 },
    });
    expect(await f.recentActions(10)).toEqual([]);

    const created = await writer(app, 'Operator Ünï')
      .post('/api/v1/owners')
      .send({ name: 'Ivan Synthetic', kind: 'person', comment: 'free text' })
      .expect(201);
    const trail = await f.auditOf(created.body.id as string); // a create is found by the id of its response
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ method: 'POST', route: '/owners' });
    const recent = await f.recentActions(10);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ operator: 'Operator Ünï', method: 'POST', route: '/owners' });
    // names never reach the trail
    expect(JSON.stringify(recent[0])).not.toContain('Ivan Synthetic');
  });

  it('records the route template, the ids of params and body and a summary without free text', async () => {
    const { f, app } = await setup();
    const owner = await f.modules.owners.createOwner({ name: 'Petr Synthetic', kind: 'person' });
    const artist = await f.modules.owners.createArtist({ pseudonym: 'Synth Artist', ownerId: owner.id });
    const doc = await f.modules.owners.createDocument({
      kind: 'contract',
      title: 'Contract Synthetic',
      fileRef: 'dummy://c.pdf',
      ownerId: owner.id,
      requiresApproval: true,
    });
    await writer(app, 'Chief')
      .post(`/api/v1/documents/${doc.id}/approve`)
      .send({ by: 'someone else' })
      .expect(200);
    const approved = await f.db.query<{ approved_by: string }>(
      'SELECT approved_by FROM owners.documents WHERE id = $1',
      [doc.id],
    );
    expect(approved.rows[0]?.approved_by).toBe('Chief'); // the header wins over the body
    const [row] = await f.auditOf(doc.id);
    expect(row).toMatchObject({ operator: 'Chief', method: 'POST', route: '/documents/:id/approve' });
    expect(row?.entityIds).toEqual([doc.id]);

    const op = await writer(app)
      .post('/api/v1/settlements/operations')
      .send({ direction: 'in', amount: '1.50', artistId: artist.id, date: '2026-08-01', comment: 'secret words', labelId: f.testLabels['0to8'] })
      .expect(201);
    const [opRow] = await f.auditOf(artist.id);
    expect(opRow?.summary).toEqual({ params: {}, body: { direction: 'in', amount: '1.50' } });
    expect(opRow?.entityIds).toContain(f.testLabels['0to8']); // the label is an entity of the write (D-168)
    expect(op.body.id).toBeTruthy();

    // a failed write leaves no trace; reads are not recorded
    const before = (await f.recentActions(100)).length;
    await writer(app).post('/api/v1/owners').send({ name: '', kind: 'x' }).expect(400);
    await writer(app).get('/api/v1/owners').expect(200);
    expect((await f.recentActions(100)).length).toBe(before);
  });

  it('keeps the free-text reason of a merge out of the summary (D-150)', async () => {
    const { f, app } = await setup();
    const from = await f.modules.owners.createOwner({ name: 'Merge From Synthetic', kind: 'person' });
    const into = await f.modules.owners.createOwner({ name: 'Merge Into Synthetic', kind: 'person' });
    const doc = await f.modules.owners.createDocument({
      kind: 'contract',
      title: 'Merge Contract Synthetic',
      fileRef: 'dummy://m.pdf',
      ownerId: into.id,
      requiresApproval: true,
    });
    await writer(app, 'Chief').post(`/api/v1/documents/${doc.id}/approve`).send({}).expect(200);
    const art = await f.modules.owners.createArtist({ pseudonym: 'Merge Artist', ownerId: null });
    await f.modules.owners.createContract({ ownerId: into.id, documentId: doc.id, artistIds: [art.id] });
    const merged = await writer(app, 'Chief')
      .post('/api/v1/owners/merge')
      .send({ fromId: from.id, intoId: into.id, reason: 'secret reason words' });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    const [row] = await f.auditOf(from.id);
    expect(row).toBeDefined();
    expect(JSON.stringify(row?.summary)).not.toContain('reason');
    expect(JSON.stringify(row)).not.toContain('secret reason words');
  });

  it('answers 2xx with X-Audit: failed when the record fails after the write (D-150)', async () => {
    const { f, app } = await setup();
    const spy = vi.spyOn(f, 'recordAction').mockRejectedValue(new Error('audit store down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await writer(app, 'Chief')
        .post('/api/v1/owners')
        .send({ name: 'Kept Synthetic', kind: 'person' })
        .expect(201);
      expect(res.headers['x-audit']).toBe('failed');
      expect(res.body.name).toBe('Kept Synthetic'); // the write happened and its result is sent
      expect(log).toHaveBeenCalled();
      expect((await f.modules.owners.listOwners()).some((o) => o.name === 'Kept Synthetic')).toBe(true);
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
    const ok = await writer(app, 'Chief').post('/api/v1/owners').send({ name: 'Other Synthetic', kind: 'person' }).expect(201);
    expect(ok.headers['x-audit']).toBeUndefined();
  });
});

describe('api details and limits', () => {
  it('parses the details of 409 possible_duplicate with the shared schema (owners and artists)', async () => {
    const f = await newFacade();
    const app = createApp(f, { tmpDir: join(TMP, 'audit-uploads') });
    await writer(app).post('/api/v1/owners').send({ name: 'Twin Synthetic', kind: 'person' }).expect(201);
    const dup = await writer(app).post('/api/v1/owners').send({ name: 'Twin Synthetic', kind: 'person' }).expect(409);
    expect(dup.body.error.code).toBe('possible_duplicate');
    expect(possibleDuplicateDetailsSchema.parse(dup.body.error.details).similar[0]?.matchedBy).toContain('name');
    await writer(app).post('/api/v1/artists').send({ pseudonym: 'Twin Artist' }).expect(201);
    const adup = await writer(app).post('/api/v1/artists').send({ pseudonym: 'Twin Artist' }).expect(409);
    expect(possibleDuplicateDetailsSchema.parse(adup.body.error.details).similar.length).toBe(1);
  });

  it('accepts /signals?limit up to 5000 and refuses more', async () => {
    const f = await newFacade();
    const app = createApp(f, { tmpDir: join(TMP, 'audit-uploads') });
    await writer(app).get('/api/v1/signals?limit=5000').expect(200);
    await writer(app).get('/api/v1/signals?limit=5001').expect(400);
  });
});
