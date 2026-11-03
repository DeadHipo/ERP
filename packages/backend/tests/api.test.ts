import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { writer } from './helpers/writer';
import { approvedAppendix, confirmedOwner, newFacade, TMP, writeBelieve } from './helpers/fixtures';

const I1 = 'QZTST2600001';
const UPC = '1234567890123';

async function setup() {
  const f = await newFacade();
  const app = createApp(f, { tmpDir: join(TMP, 'api-uploads') });
  return { f, app };
}

describe('JSON API', () => {
  it('streams a Believe upload and returns 409 with a clear message for a second file of the same period', async () => {
    const { app } = await setup();
    const file = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '10.5' }]);
    const ok = await writer(app)
      .post('/api/v1/sources/believe')
      .attach('file', file.path, file.fileName)
      .field('generatedAt', '2026-08-09T10:00:00Z');
    expect(ok.status).toBe(201);
    expect(ok.body.reportingMonth).toBe('2026-07');
    expect(ok.body.sha256).toMatch(/^[0-9a-f]{64}$/);
    const again = writeBelieve('2026-07', [{ isrc: I1, upc: UPC, net: '11' }], { reportId: '9999' });
    const dup = await writer(app).post('/api/v1/sources/believe').attach('file', again.path, again.fileName);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('duplicate_period');
    expect(dup.body.error.message).toMatch(/already loaded/);
  });

  it('lists the lines of the chosen report files with filters and paging, and validates the query', async () => {
    const { app } = await setup();
    const file = writeBelieve('2026-07', [
      { isrc: I1, upc: UPC, net: '10.5', platform: 'Spotify' },
      { isrc: I1, upc: UPC, net: '2', platform: 'Deezer' },
    ]);
    const up = await writer(app).post('/api/v1/sources/believe').attach('file', file.path, file.fileName);
    expect(up.status).toBe(201);
    const all = await writer(app).get(`/api/v1/sources/lines?fileId=${up.body.id}&limit=1`);
    expect(all.status).toBe(200);
    expect(all.body.total).toMatchObject({ keys: '2', net: '12.5' });
    expect(all.body.items).toHaveLength(1);
    expect(all.body.items[0]).toMatchObject({
      isrc: I1,
      platform: 'Spotify',
      net: '10.5',
      account: '1052428',
    });
    const one = await writer(app).get(`/api/v1/sources/lines?fileId=${up.body.id}&platform=Deezer`);
    expect(one.body.items.map((l: { net: string }) => l.net)).toEqual(['2']);
    const facets = await writer(app).get(`/api/v1/sources/lines/facets?fileId=${up.body.id}`);
    expect(facets.body.platforms).toEqual(['Deezer', 'Spotify']);
    expect((await writer(app).get('/api/v1/sources/lines?limit=0')).status).toBe(400);
    expect((await writer(app).get('/api/v1/sources/lines?sort=drop')).status).toBe(400);
    const bad = await writer(app).get('/api/v1/sources/lines?fileId=11111111-1111-1111-1111-111111111111');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');
  });

  it('validates input with zod and returns the error envelope', async () => {
    const { app } = await setup();
    const bad = await writer(app).post('/api/v1/owners').send({ name: '', kind: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');
    const limit = await writer(app).get('/api/v1/splits?limit=abc');
    expect(limit.status).toBe(400);
  });

  it('warns about possible duplicates instead of creating them', async () => {
    const { app } = await setup();
    await writer(app).post('/api/v1/owners').send({ name: 'Ivan Synthetic', kind: 'person' }).expect(201);
    const dup = await writer(app).post('/api/v1/owners').send({ name: 'ivan synthetic', kind: 'person' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.similar).toHaveLength(1);
    await writer(app)
      .post('/api/v1/owners')
      .send({ name: 'ivan synthetic', kind: 'person', force: true })
      .expect(201);
  });

  it('owner balance and payout through HTTP: money as decimal strings', async () => {
    const { f, app } = await setup();
    const a = await confirmedOwner(f, 'Owner A', ['A1']);
    await f.modules.owners.createTrack({ title: 't', isrc: I1, upc: UPC });
    await f.createSplit({
      isrc: I1,
      validFrom: '2020-01-01',
      shares: [{ artistId: a.artists[0]?.id as string, percent: '50' }],
      documentId: (await approvedAppendix(f)).id,
    });
    await f.ingestBelieve(
      writeBelieve('2026-07', [
        { isrc: I1, upc: UPC, net: '0.000000002' },
        { isrc: I1, upc: UPC, net: '300', country: 'Peru' },
      ]),
    );
    const bal = await writer(app)
      .get(`/api/v1/owners/${a.owner.id}/balance?from=2026-07&to=2026-07&basis=report`)
      .expect(200);
    expect(bal.body.total.payable).toBe('150.000000001');
    expect(bal.body.period.received).toBe('300.000000002');
    const payout = await writer(app).post(`/api/v1/owners/${a.owner.id}/payouts`).send({}).expect(201);
    expect(payout.body.amountCents).toBe(15000);
    const blocked = await writer(app).post(`/api/v1/owners/${a.owner.id}/payouts`).send({});
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('payout_blocked');
  });

  it('labels, participations and assumption documents: business errors keep their codes', async () => {
    const { app } = await setup();
    const post = (url: string, body: object) => writer(app).post(`/api/v1${url}`).send(body);
    const own = (await post('/labels', { name: 'Own Synthetic', kind: 'own' }).expect(201)).body;
    const sub = (await post('/labels', { name: 'Sub Synthetic', kind: 'sublabel', ownLabelId: own.id }).expect(201))
      .body;
    await post(`/labels/${sub.id}/aliases`, { alias: 'Sub Imprint' }).expect(201);
    const taken = await post(`/labels/${own.id}/aliases`, { alias: '  sub   IMPRINT ' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('alias_taken');
    const rule = await post(`/labels/${sub.id}/rules`, {
      percent: '10',
      recipientArtistId: 'no-such-artist',
      validFrom: '2026-01-01',
    });
    expect(rule.status).toBe(404);

    const art = (await post('/artists', { pseudonym: 'Synth One' }).expect(201)).body;
    // D-130: the rule close goes through the facade and floors the end date; an empty period is a 400
    const okRule = (
      await post(`/labels/${sub.id}/rules`, { percent: '50', recipientArtistId: art.id, validFrom: '2026-01-10' }).expect(
        201,
      )
    ).body;
    expect(okRule.validFrom).toBe('2026-01-01');
    const closed = await post(`/labels/rules/${okRule.id}/close`, { validTo: '2026-04-15' }).expect(200);
    expect(closed.body.validTo).toBe('2026-04-01');
    const empty = await post(`/labels/rules/${okRule.id}/close`, { validTo: '2026-01-20' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('empty_period');
    const emptyRule = await post(`/labels/${sub.id}/rules`, {
      percent: '50',
      recipientArtistId: art.id,
      validFrom: '2027-03-03',
      validTo: '2027-03-30',
    });
    expect(emptyRule.status).toBe(400);
    expect(emptyRule.body.error.code).toBe('empty_period');
    const bad = await post('/participations', {
      isrc: I1,
      artistId: art.id,
      percent: '5',
      base: 'bucket',
      fundedFrom: 'top',
      validFrom: '2026-01-01',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation_error');
    const missingArtist = await post('/participations', {
      isrc: I1,
      artistId: 'no-such-artist',
      percent: '5',
      base: 'net',
      fundedFrom: 'top',
      validFrom: '2026-01-01',
    });
    expect(missingArtist.status).toBe(404);

    const doc = (
      await post('/documents', { kind: 'assumption', title: 'Decision', requiresApproval: false }).expect(201)
    ).body;
    const approve = await post(`/documents/${doc.id}/approve`, {});
    expect(approve.status).toBe(422);
    expect(approve.body.error.code).toBe('assumption_not_approvable');
    const emptyPatch = await writer(app).patch('/api/v1/tracks/x').send({});
    expect(emptyPatch.status).toBe(400);
  });
});
