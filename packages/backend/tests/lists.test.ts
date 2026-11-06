import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { approvedAppendix, confirmedOwner, newFacade, TMP } from './helpers/fixtures';

// List filters and paging (N12, N14, N18), D-143. Synthetic data only.

const app = (f: Awaited<ReturnType<typeof newFacade>>) =>
  createApp(f, { tmpDir: join(TMP, 'lists-uploads') });

describe('GET /documents filters (N12)', () => {
  it('filters by status, kind, title substring, owner and limit', async () => {
    const f = await newFacade();
    const o = f.modules.owners;
    const a = await o.createOwner({ name: 'Doc Owner A', kind: 'person' });
    const b = await o.createOwner({ name: 'Doc Owner B', kind: 'person' });
    const noFile = await o.createDocument({
      kind: 'contract',
      title: 'Alpha contract',
      requiresApproval: true,
      ownerId: a.id,
    });
    const waiting = await o.createDocument({
      kind: 'appendix',
      title: 'Beta appendix',
      fileRef: 'dummy://b.pdf',
      requiresApproval: true,
      ownerId: a.id,
    });
    const approved = await o.createDocument({
      kind: 'appendix',
      title: 'Gamma Appendix',
      fileRef: 'dummy://g.pdf',
      requiresApproval: true,
      ownerId: b.id,
    });
    await o.approveDocument(approved.id, 'manager');
    const noApproval = await o.createDocument({
      kind: 'other',
      title: 'Delta note',
      fileRef: 'dummy://d.pdf',
      requiresApproval: false,
    });
    const api = app(f);
    const ids = async (qs: string) =>
      ((await request(api).get(`/api/v1/documents${qs}`)).body as { id: string }[]).map((d) => d.id);

    expect(await ids('')).toHaveLength(4);
    expect(await ids('?status=not_attached')).toEqual([noFile.id]);
    expect(await ids('?status=not_approved')).toEqual([waiting.id]);
    expect((await ids('?status=approved')).sort()).toEqual([approved.id, noApproval.id].sort());
    expect(await ids('?kind=appendix')).toEqual([waiting.id, approved.id]);
    expect(await ids('?q=APPENDIX')).toEqual([waiting.id, approved.id]);
    expect(await ids(`?ownerId=${a.id}&kind=appendix`)).toEqual([waiting.id]);
    const page = (await request(api).get('/api/v1/documents?limit=2')).body as { total: number; items: unknown[] };
    expect(page.items).toHaveLength(2); // `limit` gives a page (D-177)
    expect(page.total).toBe(4);
    expect((await request(api).get('/api/v1/documents?status=bogus')).status).toBe(400);
  });
});

describe('GET /settlements/operations filters (N14)', () => {
  it('filters by meaning, direction, needsProof, active, dates and adds the names', async () => {
    const f = await newFacade();
    const { owner, artists } = await confirmedOwner(f, 'Op Owner', ['Op Pseudonym']);
    const art = artists[0]?.id as string;
    const mk = (extra: object) =>
      f.createOperation({ labelId: f.testLabels['0to8'],
        amount: '10',
        artistId: art,
        date: '2026-03-10',
        comment: 'c',
        migration: true,
        ...extra,
      } as never);
    const payout = await mk({ direction: 'out', date: '2026-03-10' });
    const proofed = await mk({ direction: 'out', date: '2026-04-10' });
    await f.attachPaymentProof(proofed.id, { fileRef: 'dummy://proof.pdf' });
    const deduction = await mk({ direction: 'in', date: '2026-05-10' });
    const api = app(f);
    const get = async (qs: string) =>
      (await request(api).get(`/api/v1/settlements/operations${qs}`)).body as {
        id: string;
        ownerName: string | null;
        pseudonym: string | null;
        meaning: string;
      }[];

    const all = await get('');
    expect(all).toHaveLength(3);
    expect(all.every((o) => o.ownerName === 'Op Owner' && o.pseudonym === 'Op Pseudonym')).toBe(true);
    expect((await get('?needsProof=true')).map((o) => o.id)).toEqual([payout.id]);
    expect((await get('?direction=in')).map((o) => o.id)).toEqual([deduction.id]);
    expect((await get('?meaning=payout')).map((o) => o.id)).toEqual([proofed.id, payout.id]);
    expect((await get('?meaning=deduction')).map((o) => o.id)).toEqual([deduction.id]);
    expect(await get('?meaning=return')).toEqual([]);
    expect((await get('?from=2026-04-01&to=2026-04-30')).map((o) => o.id)).toEqual([proofed.id]);
    expect(await get(`?ownerId=${owner.id}&artistId=${art}`)).toHaveLength(3);
    expect(await get('?ownerId=nobody')).toEqual([]);

    await f.modules.settlements.deactivate(payout.id, 'mistake', { transferFailed: false });
    expect((await get('?active=false')).map((o) => o.id)).toEqual([payout.id]);
    expect((await get('?active=true')).map((o) => o.id)).toHaveLength(2);
    expect(await get('?needsProof=true')).toEqual([]);
    expect((await request(api).get('/api/v1/settlements/operations?from=bad')).status).toBe(400);
  });
});

describe('paging of /splits and /participations (N18)', () => {
  it('pages participations with a stable total and filters unconfirmed splits', async () => {
    const f = await newFacade();
    const doc = await approvedAppendix(f);
    const pending = await f.modules.owners.createDocument({
      kind: 'appendix',
      title: 'Pending',
      fileRef: 'dummy://p.pdf',
      requiresApproval: true,
    });
    const { artists } = await confirmedOwner(f, 'Page Owner', ['Pager']);
    const a = artists[0]?.id as string;
    for (let i = 1; i <= 5; i++) {
      await f.createParticipation({
        isrc: `QZTST260000${i}`,
        artistId: a,
        percent: '5',
        base: 'net',
        fundedFrom: 'top',
        validFrom: '2026-01-01',
      });
    }
    const mkSplit = (n: number, documentId: string | null) =>
      f.createSplit({
        isrc: `QZTST260001${n}`,
        validFrom: '2026-01-01',
        shares: [{ artistId: a, percent: '50' }],
        documentId,
      });
    const sOk = await mkSplit(1, doc.id);
    const sPending = await mkSplit(2, pending.id);
    const sNone = await mkSplit(3, null);
    const sOk2 = await mkSplit(4, doc.id);
    const api = app(f);

    const all = (await request(api).get('/api/v1/participations')).body;
    expect(all.total).toBe(5);
    expect(all.items).toHaveLength(5);
    const p1 = (await request(api).get('/api/v1/participations?limit=2&offset=0')).body;
    const p2 = (await request(api).get('/api/v1/participations?limit=2&offset=2')).body;
    const p3 = (await request(api).get('/api/v1/participations?limit=2&offset=4')).body;
    expect([p1.total, p2.total, p3.total]).toEqual([5, 5, 5]);
    expect([p1.items.length, p2.items.length, p3.items.length]).toEqual([2, 2, 1]);
    const paged = [...p1.items, ...p2.items, ...p3.items].map((x: { id: string }) => x.id);
    expect(paged).toEqual(all.items.map((x: { id: string }) => x.id));

    const sp = async (qs: string) =>
      (await request(api).get(`/api/v1/splits${qs}`)).body as { total: number; items: { id: string }[] };
    expect((await sp('')).total).toBe(4);
    const unconf = await sp('?status=unconfirmed');
    expect(unconf.total).toBe(2);
    expect(unconf.items.map((s) => s.id).sort()).toEqual([sPending.id, sNone.id].sort());
    const page = await sp('?limit=2&offset=2');
    expect(page.total).toBe(4);
    expect(page.items).toHaveLength(2);
    const full = (await sp('')).items.map((s) => s.id);
    expect(page.items.map((s) => s.id)).toEqual(full.slice(2));
    expect([sOk.id, sOk2.id].every((id) => full.includes(id))).toBe(true);
    expect((await sp('?status=unconfirmed&limit=1&offset=1')).items).toHaveLength(1);
    expect((await request(api).get('/api/v1/splits?status=bogus')).status).toBe(400);
  });
});
