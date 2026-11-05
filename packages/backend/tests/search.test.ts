import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { approvedAppendix, newFacade, TMP, writeBelieve } from './helpers/fixtures';

// Global search (N10) and duplicate pseudonyms (N11), D-143. Synthetic data only.

const UPC = '1234567890123';
const app = (f: Awaited<ReturnType<typeof newFacade>>) =>
  createApp(f, { tmpDir: join(TMP, 'search-uploads') });

describe('GET /search (N10)', () => {
  it('finds an exact ISRC first, a pseudonym by substring, an owner by alias, a label and a document', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const owner = await o.createOwner({ name: 'Quartz Holder', kind: 'person', aliases: ['Zed Alias Name'] });
    await o.createArtist({ pseudonym: 'Moonlight Fox', ownerId: owner.id });
    await o.createTrack({ title: 'Fox Song', isrc: 'QZTST2600001', upc: UPC });
    await o.createTrack({ title: 'qztst2600001 in a title', isrc: 'QZTST2600002', upc: '1234567890124' });
    await o.createDocument({
      kind: 'contract',
      title: 'Fox contract 2026',
      requiresApproval: true,
      ownerId: owner.id,
    });
    const api = app(f);

    const byIsrc = (await request(api).get('/api/v1/search?q=qztst2600001')).body;
    expect(byIsrc.tracks.map((t: { isrc: string }) => t.isrc)).toEqual(['QZTST2600001', 'QZTST2600002']);

    const byPseudonym = (await request(api).get('/api/v1/search?q=%20NLIGHT%20')).body;
    expect(byPseudonym.artists.map((a: { pseudonym: string }) => a.pseudonym)).toEqual(['Moonlight Fox']);
    expect(byPseudonym.artists[0].status).toBe('unconfirmed');

    const byAlias = (await request(api).get('/api/v1/search?q=zed alias')).body;
    expect(byAlias.owners).toEqual([
      { id: owner.id, name: 'Quartz Holder', status: 'waiting_documents', kind: 'person' },
    ]);

    const fox = (await request(api).get('/api/v1/search?q=fox')).body;
    expect(fox.documents.map((d: { title: string }) => d.title)).toEqual(['Fox contract 2026']);
    expect(fox.documents[0].status).toBe('not_attached');
    expect(fox.labels).toEqual([]);

    const label = (await request(api).get('/api/v1/search?q=echo')).body;
    expect(label.labels.map((l: { name: string }) => l.name)).toEqual(['Echo8']);

    // LIKE wildcards are plain characters
    expect((await request(api).get('/api/v1/search?q=%25')).body.owners).toEqual([]);
  });

  it('restricts to kinds, caps at 10 per kind and refuses an empty q or an unknown kind', async () => {
    const f = await newFacade();
    for (let i = 0; i < 12; i++) {
      await f.modules.owners.createOwner({ name: `Match Owner ${i}`, kind: 'person' });
      await f.modules.owners.createArtist({ pseudonym: `Match Artist ${i}`, ownerId: null });
    }
    const api = app(f);
    const all = (await request(api).get('/api/v1/search?q=match')).body;
    expect(all.owners).toHaveLength(10);
    expect(all.artists).toHaveLength(10);
    const only = (await request(api).get('/api/v1/search?q=match&kinds=artists,labels')).body;
    expect(only.owners).toEqual([]);
    expect(only.artists).toHaveLength(10);
    expect((await request(api).get('/api/v1/search?q=%20%20')).status).toBe(400);
    expect((await request(api).get('/api/v1/search')).status).toBe(400);
    expect((await request(api).get('/api/v1/search?q=a&kinds=nope')).status).toBe(400);
  });
});

describe('GET /artists/duplicates (N11)', () => {
  it('groups equal normalised pseudonyms and lists the ISRCs without a split that Believe attributes to the name', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const owner = await o.createOwner({ name: 'Dup Owner', kind: 'person' });
    const a1 = await o.createArtist({ pseudonym: 'Night Owl', ownerId: owner.id });
    const a2 = await o.createArtist({ pseudonym: '  night   OWL ', ownerId: null });
    await o.createArtist({ pseudonym: 'Unique One', ownerId: null });
    const doc = await approvedAppendix(f);
    await f.createSplit({
      isrc: 'QZTST2600001',
      validFrom: '2026-01-01',
      shares: [{ artistId: a1.id, percent: '50' }],
      documentId: doc.id,
    });
    await f.createParticipation({
      isrc: 'QZTST2600001',
      artistId: a2.id,
      percent: '5',
      base: 'net',
      fundedFrom: 'top',
      validFrom: '2026-01-01',
    });
    await f.ingestBelieve(
      writeBelieve('2026-03', [
        { isrc: 'QZTST2600001', upc: UPC, net: '10', artistName: 'Night Owl', trackTitle: 'With split' },
        { isrc: 'QZTST2600002', upc: UPC, net: '7.5', artistName: 'NIGHT owl', trackTitle: 'Orphan' },
        { isrc: 'QZTST2600002', upc: UPC, net: '2.5', artistName: 'NIGHT owl', trackTitle: 'Orphan' },
        { isrc: 'QZTST2600003', upc: UPC, net: '1', artistName: 'Someone Else', trackTitle: 'Other' },
      ]), f.testLabels['0to8'],
    );

    const res = await request(app(f)).get('/api/v1/artists/duplicates');
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
    const g = res.body.groups[0];
    expect(g.normalized).toBe('night owl');
    expect(g.artists).toHaveLength(2);
    const one = g.artists.find((a: { id: string }) => a.id === a1.id);
    const two = g.artists.find((a: { id: string }) => a.id === a2.id);
    expect(one).toMatchObject({
      ownerName: 'Dup Owner',
      splitRows: 1,
      participations: 0,
      status: 'unconfirmed',
    });
    expect(two).toMatchObject({
      ownerId: null,
      ownerName: null,
      splitRows: 0,
      participations: 1,
      status: 'no_owner',
    });
    expect(g.candidateIsrcs).toEqual([{ isrc: 'QZTST2600002', upc: UPC, trackTitle: 'Orphan', net: '10' }]);
  });

  it('is empty without duplicates', async () => {
    const f = await newFacade();
    await f.modules.owners.createArtist({ pseudonym: 'Solo', ownerId: null });
    expect((await request(app(f)).get('/api/v1/artists/duplicates')).body).toEqual({ groups: [] });
  });
});
