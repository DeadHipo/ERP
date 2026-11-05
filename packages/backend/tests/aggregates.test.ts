import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { join } from 'node:path';
import { createApp } from '../src/api/app';
import { payoutGate } from '../src/facade/payout-gate';
import { ZERO } from '../src/shared/money';
import { approvedAppendix, approvedDoc, newFacade, TMP, unconfirmedOwner } from './helpers/fixtures';
import { Case, I, single, UPC } from './helpers/golden-case';

// The money aggregates for the screens (D-142, 17 N4..N19) on synthetic golden-style data.

const appOf = (c: Case) => createApp(c.f, { tmpDir: join(TMP, 'aggregates-uploads') });

/** The G27 world: A row 50, P 15 of the label share, an advance 10 on P with proof; P payable 5. */
async function g27(threshold = 0) {
  const c = new Case();
  c.f = await newFacade(threshold);
  c.appendix = (await approvedAppendix(c.f)).id;
  await c.person('A', 'P');
  await c.track(I(1));
  await c.split(I(1), [['A', '50']]);
  await c.part(I(1), 'P', '15', 'bucket', 'label_share');
  await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
  await c.load('2026-04', [{ isrc: I(1), net: '100' }]);
  const basis = await approvedDoc(c.f, 'advance_basis', c.owners.get('P'));
  const op = await c.f.createOperation({ labelId: c.f.testLabels['0to8'],
    direction: 'out',
    amount: '10',
    artistId: c.id('P'),
    date: '2026-03-01',
    scope: { kind: 'any' },
    documentId: basis.id,
    comment: 'advance',
  });
  await c.f.attachPaymentProof(op.id, { fileRef: 'dummy://proof.pdf' });
  return c;
}

describe('payoutGate (N19): the order of the checks', () => {
  const ok = { confirmed: true, blocking: [] as string[], payableCents: 500, thresholdCents: 0 };
  it('is owner_not_confirmed, payout_blocked, nothing_to_pay, below_threshold, then allowed', () => {
    expect(payoutGate({ ...ok, confirmed: false, blocking: ['x'], payableCents: 0 }).reason).toBe(
      'owner_not_confirmed',
    );
    expect(payoutGate({ ...ok, blocking: ['x'], payableCents: 0 }).reason).toBe('payout_blocked');
    expect(payoutGate({ ...ok, payableCents: 0, thresholdCents: 10000 }).reason).toBe('nothing_to_pay');
    expect(payoutGate({ ...ok, payableCents: -700 })).toEqual({
      allowed: false,
      reason: 'nothing_to_pay',
      amountCents: 0,
    });
    expect(payoutGate({ ...ok, thresholdCents: 10000 })).toEqual({
      allowed: false,
      reason: 'below_threshold',
      amountCents: 500,
    });
    expect(payoutGate(ok)).toEqual({ allowed: true, reason: null, amountCents: 500 });
  });
});

describe('the payout gate field and the payout button agree (N19)', () => {
  it('allowed, then payout_blocked after a payout without proof, then nothing_to_pay after the proof', async () => {
    const c = await g27();
    const p = c.owners.get('P') as string;
    expect((await c.f.ownerBalance(p)).payout).toEqual({ allowed: true, reason: null, amountCents: 500 });
    const op = await c.f.createPayout(p, { labelId: c.f.testLabels['0to8'] });
    expect(op.amountCents).toBe(500);
    const blocked = (await c.f.ownerBalance(p)).payout;
    expect(blocked).toEqual({ allowed: false, reason: 'payout_blocked', amountCents: 500 });
    await expect(c.f.createPayout(p, { labelId: c.f.testLabels['0to8'] })).rejects.toMatchObject({ code: 'payout_blocked' });
    await c.f.attachPaymentProof(op.id, { fileRef: 'dummy://proof.pdf' });
    expect((await c.f.ownerBalance(p)).payout).toMatchObject({ allowed: false, reason: 'nothing_to_pay' });
    await expect(c.f.createPayout(p, { labelId: c.f.testLabels['0to8'] })).rejects.toMatchObject({ code: 'nothing_to_pay' });
    // the owner with no income at all
    const a = c.owners.get('A') as string;
    expect((await c.f.ownerBalance(a)).payout.allowed).toBe(true);
  });

  it('below_threshold: payable 5 with the threshold 100', async () => {
    const c = await g27(10000);
    const p = c.owners.get('P') as string;
    const gate = (await c.f.ownerBalance(p)).payout;
    expect(gate).toEqual({ allowed: false, reason: 'below_threshold', amountCents: 500 });
    await expect(c.f.createPayout(p, { labelId: c.f.testLabels['0to8'] })).rejects.toMatchObject({ code: 'below_threshold' });
  });

  it('owner_not_confirmed: an owner without an approved contract', async () => {
    const c = await single(async (c) => {
      await c.person('A');
      await c.split(I(1), [['A', '50']]);
    });
    const u = await unconfirmedOwner(c.f, 'Owner U', ['U']);
    await c.f.createSplit({
      isrc: I(2),
      validFrom: '2020-01-01',
      shares: [{ artistId: (u.artists[0] as { id: string }).id, percent: '30' }],
      documentId: c.appendix,
    });
    const gate = (await c.f.ownerBalance(u.owner.id)).payout;
    expect(gate.reason).toBe('owner_not_confirmed');
    await expect(c.f.createPayout(u.owner.id, { labelId: c.f.testLabels['0to8'] })).rejects.toMatchObject({ code: 'owner_not_confirmed' });
  });

  it('a balance over the API carries payout', async () => {
    const c = await g27();
    const res = await request(appOf(c)).get(`/api/v1/owners/${c.owners.get('P')}/balance`).expect(200);
    expect(res.body.payout).toEqual({ allowed: true, reason: null, amountCents: 500 });
  });
});

/** Owners of a mixed world: A (row), P (advance), M (migration payout), U (unconfirmed), a publishing owner. */
async function world() {
  const c = new Case();
  c.f = await newFacade(0);
  c.appendix = (await approvedAppendix(c.f)).id;
  await c.person('A', 'P', 'M');
  await c.track(I(1));
  await c.track(I(2));
  await c.track(I(3)); // no money at all
  await c.split(I(1), [['A', '50']]);
  await c.part(I(1), 'P', '15', 'bucket', 'label_share');
  await c.split(I(2), [['M', '50']]);
  const u = await unconfirmedOwner(c.f, 'Owner U', ['U']);
  await c.f.modules.owners.createTrack({ title: 'U track', isrc: I(4), upc: UPC, artistIds: [] });
  await c.f.createSplit({
    isrc: I(4),
    validFrom: '2020-01-01',
    shares: [{ artistId: (u.artists[0] as { id: string }).id, percent: '30' }],
    documentId: c.appendix,
  });
  await c.load('2026-03', [
    { isrc: I(1), net: '100' },
    { isrc: I(2), net: '40' },
    { isrc: I(4), net: '10' },
    { isrc: I(7), net: '3' }, // an unknown pair
  ]);
  await c.load('2026-04', [
    { isrc: I(1), net: '60' },
    { isrc: I(2), net: '20', label: 'Other Label' },
  ]);
  const basis = await approvedDoc(c.f, 'advance_basis', c.owners.get('P'));
  const adv = await c.f.createOperation({ labelId: c.f.testLabels['0to8'],
    direction: 'out',
    amount: '10',
    artistId: c.id('P'),
    date: '2026-03-01',
    scope: { kind: 'any' },
    documentId: basis.id,
    comment: 'advance',
  });
  await c.f.attachPaymentProof(adv.id, { fileRef: 'dummy://proof.pdf' });
  await c.f.createOperation({ labelId: c.f.testLabels['0to8'],
    direction: 'out',
    amount: '5',
    ownerId: c.owners.get('M') as string,
    date: '2026-04-02',
    comment: 'migration',
    migration: true,
  });
  await c.f.createPayout(c.owners.get('A') as string, { labelId: c.f.testLabels['0to8'] }); // deferred: blocks A
  return { c, u };
}

describe('GET /owners/payables (N4)', () => {
  it('every item equals the fields of ownerBalance() called the normal way, gate included', async () => {
    const { c, u } = await world();
    const res = await request(appOf(c)).get('/api/v1/owners/payables').expect(200);
    const list = await c.f.modules.owners.listOwners();
    expect(res.body.items).toHaveLength(list.length);
    expect(typeof res.body.calculatedAt).toBe('string');
    const by = new Map((res.body.items as { ownerId: string }[]).map((i) => [i.ownerId, i as any])); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const o of list) {
      const b = await c.f.ownerBalance(o.id);
      const item = by.get(o.id);
      expect(item, `item of ${o.name}`).toBeDefined();
      expect(item).toMatchObject({ name: o.name, kind: o.kind, status: o.status, confirmed: b.confirmed });
      for (const k of ['earned', 'waiting', 'recouped', 'paid', 'returns', 'credits', 'payable', 'payableShown'] as const)
        expect(item[k], `${o.name} ${k}`).toBe(b.total[k].toFixed());
      expect(item.payableNegative).toBe(b.total.payableNegative);
      expect(item.waitingBreakdown).toEqual(
        Object.fromEntries(Object.entries(b.period.waitingBreakdown).map(([k, v]) => [k, v.toFixed()])),
      );
      expect(item.payout).toEqual(JSON.parse(JSON.stringify(b.payout)));
      expect(item.blockingPayouts).toBe(b.blockingPayouts.length);
      expect(item.pendingOperations).toBe(b.pendingOperations.length);
    }
    // the cases of the world
    const a = by.get(c.owners.get('A') as string);
    expect(a).toMatchObject({ payout: { allowed: false, reason: 'payout_blocked' }, blockingPayouts: 1 });
    expect(a.lastPayoutDate).not.toBeNull();
    const p = by.get(c.owners.get('P') as string);
    expect(p).toMatchObject({ recouped: '10', payout: { allowed: true, reason: null } });
    expect(by.get(c.owners.get('M') as string)).toMatchObject({ paid: '5', lastPayoutDate: '2026-04-02' });
    const un = by.get(u.owner.id);
    expect(un).toMatchObject({ confirmed: false, earned: '0', payout: { reason: 'owner_not_confirmed' } });
    expect(un.waitingBreakdown.owner_unconfirmed).toBe('3');
  });

  it('a period filter shapes waitingBreakdown only, like the balance', async () => {
    const { c, u } = await world();
    const f = { from: '2026-04', to: '2026-04' };
    const res = await request(appOf(c)).get('/api/v1/owners/payables').query(f).expect(200);
    const item = (res.body.items as { ownerId: string; waitingBreakdown: object }[]).find(
      (i) => i.ownerId === u.owner.id,
    );
    const b = await c.f.ownerBalance(u.owner.id, f);
    expect(Object.keys(item?.waitingBreakdown ?? {})).toEqual(Object.keys(b.period.waitingBreakdown));
  });
});

describe('GET /tracks/summary (N5)', () => {
  const sums = (xs: { B: string; C: string; ours: string; net: string }[]) =>
    ['B', 'C', 'ours', 'net'].map((k) =>
      xs.reduce((s, x) => s.add((x as Record<string, string>)[k] as string), ZERO).toFixed(),
    );
  it('the sums of B, C, ours and net equal the believe reconciliation rows, for every filter', async () => {
    const { c } = await world();
    const app = appOf(c);
    for (const q of [{}, { month: '2026-04' }, { month: '2026-03' }, { account: '1052428', month: '2026-03' }]) {
      const res = await request(app).get('/api/v1/tracks/summary').query(q).expect(200);
      const rows = (await c.f.reconciliation()).filter(
        (r) =>
          r.source === 'believe' &&
          (q as { month?: string }).month === undefined ||
          (r.source === 'believe' && r.month === (q as { month?: string }).month),
      );
      const filtered = rows.filter((r) => r.source === 'believe' && ((q as { account?: string }).account === undefined || r.account === (q as { account?: string }).account));
      const expected = ['B_notOurs', 'C_waiting', 'ourShare', 'A_received'].map((k) =>
        filtered.reduce((s, r) => s.add((r as unknown as Record<string, typeof s>)[k] as typeof s), ZERO).toFixed(),
      );
      expect(sums(res.body.items), JSON.stringify(q)).toEqual(expected);
    }
  });

  it('lists every track, shows zeros for a track without money, flags splits and carries names', async () => {
    const { c } = await world();
    const res = await request(appOf(c)).get('/api/v1/tracks/summary').expect(200);
    const items = res.body.items as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const t1 = items.find((i) => i.isrc === I(1));
    expect(t1).toMatchObject({
      upcs: [UPC],
      net: '160',
      B: '92', // A 50 + 30, P 15 % of the label share: 7.5 + 4.5
      hasSplit: true,
      hasParticipations: true,
      months: { from: '2026-03', to: '2026-04', count: 2 },
    });
    const empty = items.find((i) => i.isrc === I(3));
    expect(empty).toMatchObject({ net: '0', B: '0', C: '0', ours: '0', hasSplit: false, months: { from: null, count: 0 } });
    const unknown = items.find((i) => i.isrc === I(7));
    expect(unknown).toMatchObject({ net: '3', C: '3', cByReason: { unknown_pair: '3' } });
    expect(items.find((i) => i.isrc === I(2)).cByReason).toEqual({ label_unmapped: '10' });
    expect(t1.title).toBe(I(1));
    // D-166: the pseudonyms of the registry on the ISRC (the row of A, the participation of P), by pseudonym; none for a bare ISRC
    expect(t1.artists).toEqual([
      { id: c.id('A'), pseudonym: 'A' },
      { id: c.id('P'), pseudonym: 'P' },
    ]);
    expect(empty.artists).toEqual([]);
    expect(unknown.artists).toEqual([]);
    const catalog = (await request(appOf(c)).get('/api/v1/tracks/catalog').expect(200)).body.items as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(catalog.map((i) => [i.isrc, i.artists])).toEqual(items.map((i) => [i.isrc, i.artists]));
    const page = (await request(appOf(c)).get('/api/v1/tracks/summary').query({ isrcs: I(1) }).expect(200)).body.items as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(page.map((i) => [i.isrc, i.artists])).toEqual([[I(1), t1.artists]]);
    const money = (await request(appOf(c)).get(`/api/v1/tracks/${I(1)}/money`).expect(200)).body;
    expect(money.artists).toEqual(t1.artists);
  });

  it('a registry link and a merged pseudonym: the link counts, the merged id answers as the survivor, once (D-166)', async () => {
    const c = new Case();
    c.f = await newFacade(0);
    c.appendix = (await approvedAppendix(c.f)).id;
    await c.person('A', 'L');
    await c.second('A2', 'A');
    await c.track(I(1), UPC, ['L']); // L is linked in the registry, has no row
    await c.split(I(1), [['A2', '40']]);
    await c.f.modules.owners.mergeArtists(c.id('A2'), c.id('A'), 'same person');
    const items = (await request(appOf(c)).get('/api/v1/tracks/summary').expect(200)).body.items as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(items.find((i) => i.isrc === I(1)).artists).toEqual([
      { id: c.id('A'), pseudonym: 'A' },
      { id: c.id('L'), pseudonym: 'L' },
    ]);
  });
});

describe('GET /tracks/:isrc/money (N6)', () => {
  it('Σ allocations + label share = net per month; totals equal the explanation', async () => {
    const { c } = await world();
    const res = await request(appOf(c)).get(`/api/v1/tracks/${I(1)}/money`).expect(200);
    const body = res.body as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(body.isrc).toBe(I(1));
    expect(body.tracks).toHaveLength(1);
    expect(body.splits).toHaveLength(1);
    expect(body.participations).toHaveLength(1);
    expect(body.months).toHaveLength(2);
    for (const m of body.months) {
      const sum = m.allocations.reduce((s: any, a: any) => s.add(a.amount), ZERO).add(m.labelShare); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(sum.toFixed(), m.reportingMonth).toBe(m.net);
      expect(m.layers.at(-1).layer).toBe('categorise');
      expect(m.allocations.map((a: { pseudonym: string }) => a.pseudonym).sort()).toEqual(['A', 'P']);
      expect(m.allocations.every((a: { ownerName: string | null; documentStatus: string }) => a.ownerName && a.documentStatus === 'approved')).toBe(true);
    }
    const explain = await c.f.explainTrack(I(1));
    const units = explain.units;
    const net = units.reduce((s, u) => s.add(u.net), ZERO);
    const ours = units.reduce((s, u) => s.add(u.ours), ZERO);
    const b = units.flatMap((u) => u.allocations).filter((a) => a.category === 'B').reduce((s, a) => s.add(a.amount), ZERO);
    expect(body.totals).toMatchObject({ net: net.toFixed(), ours: ours.toFixed(), B: b.toFixed(), C: '0' });
  });
});

describe('GET /tracks/:isrc/breakdown/:month (N7)', () => {
  it('returns the platform and country rows of that report month of the loaded files only', async () => {
    const { c } = await world();
    const app = appOf(c);
    const res = await request(app).get(`/api/v1/tracks/${I(1)}/breakdown/2026-04`).expect(200);
    expect(res.body.isrc).toBe(I(1));
    expect(res.body.month).toBe('2026-04');
    expect(res.body.rows.length).toBeGreaterThan(0);
    for (const r of res.body.rows) expect(r.reportingMonth).toBe('2026-04');
    const net = (res.body.rows as { net: string }[]).reduce((s, r) => s.add(r.net), ZERO);
    expect(net.toFixed()).toBe('60');
    const none = await request(app).get(`/api/v1/tracks/${I(1)}/breakdown/2025-01`).expect(200);
    expect(none.body.rows).toEqual([]);
    await request(app).get(`/api/v1/tracks/${I(1)}/breakdown/2026-13`).expect(400);
  });
});

describe('releases (N8, N9)', () => {
  it('GET /releases groups the tracks by UPC with the net of the loaded files and filters by q', async () => {
    const { c } = await world();
    const app = appOf(c);
    const res = await request(app).get('/api/v1/releases').expect(200);
    expect(res.body.items).toEqual([expect.objectContaining({ upc: UPC, trackCount: 4, net: '233' })]);
    // D-166: the pseudonyms over the tracks of the UPC (A and P on I1, M on I2, U on I4), by pseudonym; q finds a pseudonym too
    expect(res.body.items[0].artists.map((a: { pseudonym: string }) => a.pseudonym)).toEqual(['A', 'M', 'P', 'U']);
    const hit = await request(app).get('/api/v1/releases').query({ q: UPC.slice(2, 6) }).expect(200);
    expect(hit.body.items).toHaveLength(1);
    expect((await request(app).get('/api/v1/releases').query({ q: 'm' }).expect(200)).body.items).toHaveLength(1);
    const miss = await request(app).get('/api/v1/releases').query({ q: 'no-such-release' }).expect(200);
    expect(miss.body.items).toEqual([]);
  });

  it('GET /releases/:upc: tracks and months add up to the units', async () => {
    const { c } = await world();
    const app = appOf(c);
    const res = await request(app).get(`/api/v1/releases/${UPC}`).expect(200);
    const sum = (xs: { net: string; B: string; C: string; ours: string }[], k: 'net' | 'B' | 'C' | 'ours') =>
      xs.reduce((s, x) => s.add(x[k]), ZERO).toFixed();
    for (const k of ['net', 'B', 'C', 'ours'] as const) {
      expect(sum(res.body.tracks, k)).toBe(sum(res.body.months, k));
    }
    expect(res.body.tracks.map((t: { isrc: string }) => t.isrc)).toEqual([I(1), I(2), I(3), I(4), I(7)]);
    // D-166: the pseudonyms of every track and their union in the header
    expect(res.body.tracks.map((t: { artists: { pseudonym: string }[] }) => t.artists.map((a) => a.pseudonym))).toEqual([['A', 'P'], ['M'], [], ['U'], []]);
    expect(res.body.artists.map((a: { pseudonym: string }) => a.pseudonym)).toEqual(['A', 'M', 'P', 'U']);
    expect(res.body.months.map((m: { reportingMonth: string }) => m.reportingMonth)).toEqual(['2026-03', '2026-04']);
    expect(sum(res.body.tracks, 'net')).toBe('233');
    await request(app).get('/api/v1/releases/0000000000000').expect(404);
  });
});

describe('GET /documents/:id/uses (N13)', () => {
  it('a split confirmed by an unapproved document: its money waits for the document, then not', async () => {
    const c = await Case.start();
    await c.person('A');
    await c.track(I(1));
    const o = c.f.modules.owners;
    const doc = await o.createDocument({
      kind: 'appendix',
      title: 'Appendix draft',
      fileRef: 'dummy://x.pdf',
      requiresApproval: true,
    });
    await c.split(I(1), [['A', '50']], { doc: doc.id });
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    const app = appOf(c);
    let res = await request(app).get(`/api/v1/documents/${doc.id}/uses`).expect(200);
    expect(res.body.document.id).toBe(doc.id);
    expect(res.body.splits).toHaveLength(1);
    expect(res.body.rowsOnly).toEqual([]);
    expect(res.body.waiting).toEqual({ amount: '50', cByReason: { split_unconfirmed: '50' } });
    await o.approveDocument(doc.id, 'manager');
    res = await request(app).get(`/api/v1/documents/${doc.id}/uses`).expect(200);
    expect(res.body.waiting).toEqual({ amount: '0', cByReason: {} });
    expect(res.body.splits).toHaveLength(1);
  });

  it('a row document, a participation and an operation are listed', async () => {
    const c = await Case.start();
    await c.person('A', 'P');
    await c.track(I(1));
    const o = c.f.modules.owners;
    const rowDoc = await o.createDocument({ kind: 'appendix', title: 'Row', fileRef: 'dummy://r.pdf', requiresApproval: false });
    await c.split(I(1), [['A', '50', rowDoc.id]]);
    await c.part(I(1), 'P', '10', 'bucket', 'label_share', { doc: rowDoc.id });
    const res = await request(appOf(c)).get(`/api/v1/documents/${rowDoc.id}/uses`).expect(200);
    expect(res.body.splits).toHaveLength(0);
    expect(res.body.rowsOnly).toEqual([expect.objectContaining({ isrc: I(1), artistId: c.id('A') })]);
    expect(res.body.participations).toHaveLength(1);
    await request(appOf(c)).get('/api/v1/documents/nope/uses').expect(404);
  });

  it('a contract document: the owner_unconfirmed money of the owners it confirms', async () => {
    const c = await Case.start();
    const o = c.f.modules.owners;
    const owner = await o.createOwner({ name: 'Owner U', kind: 'person' });
    const artist = await o.createArtist({ pseudonym: 'U', ownerId: owner.id });
    const contract = await o.createDocument({
      kind: 'contract',
      title: 'Contract U',
      fileRef: 'dummy://c.pdf',
      ownerId: owner.id,
      requiresApproval: true,
    });
    await o.createContract({ ownerId: owner.id, documentId: contract.id, artistIds: [artist.id] });
    await c.track(I(1));
    await c.f.createSplit({
      isrc: I(1),
      validFrom: '2020-01-01',
      shares: [{ artistId: artist.id, percent: '50' }],
      documentId: c.appendix,
    });
    await c.load('2026-03', [{ isrc: I(1), net: '100' }]);
    const app = appOf(c);
    let res = await request(app).get(`/api/v1/documents/${contract.id}/uses`).expect(200);
    expect(res.body.contracts).toHaveLength(1);
    expect(res.body.waiting).toEqual({ amount: '50', cByReason: { owner_unconfirmed: '50' } });
    await o.approveDocument(contract.id, 'manager');
    res = await request(app).get(`/api/v1/documents/${contract.id}/uses`).expect(200);
    expect(res.body.waiting).toEqual({ amount: '0', cByReason: {} });
  });
});

describe('the payout snapshot (N15)', () => {
  it('the stored snapshot fits payoutSnapshotSchema', async () => {
    const c = await g27();
    const op = await c.f.createPayout(c.owners.get('P') as string, { labelId: c.f.testLabels['0to8'] });
    const res = await request(appOf(c)).get(`/api/v1/settlements/operations/${op.id}/snapshot`).expect(200);
    const { payoutSnapshotSchema } = await import('@erp/shared/api-responses');
    expect(payoutSnapshotSchema.parse(res.body).amountCents).toBe(500);
    expect(res.body.files.believe).toHaveLength(2);
  });
});
