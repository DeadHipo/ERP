import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServerApp } from '../src/api/server-app';
import { createAuthService } from '../src/auth/service';
import { createOrgFacades } from '../src/orgs/facades';
import { labelsViewer } from '../src/facade/viewer';
import { approvedAppendix, confirmedOwner, newFacade, TMP, writeB17, writeBelieve, type TestFacade } from './helpers/fixtures';
import { testStack } from './helpers/test-sources';

// The onboarding checklists (D-172, plan «этап4_онбординг.md» §1.4, §6): the backend decides every step from reads
// only, never a calculation. Synthetic data only.

const ACC = '1077777';
const I = (n: number) => `QZTST26090${String(n).padStart(2, '0')}`;
const UPC = '1234567890999';

type Step = { key: string; state: string; count: number; counts: Record<string, number>; months?: unknown; values?: string[] };
const byKey = (steps: Step[]) => Object.fromEntries(steps.map((s) => [s.key, s]));
const states = (steps: Step[]) => Object.fromEntries(steps.map((s) => [s.key, s.state]));

/** Counts the reads of the sources service the facade makes (the real service behind the test proxy is patched). */
async function spyReads() {
  const service = (await testStack()).service as unknown as Record<string, (...a: unknown[]) => unknown>;
  const calls: Record<string, number> = {};
  const saved: Record<string, (...a: unknown[]) => unknown> = {};
  for (const name of ['snapshot', 'units', 'netByUpc', 'netByIsrc', 'isrcFilePairs', 'labelStringsOfFiles', 'isrcsOfUpcs', 'isrcsOfFiles', 'lines']) {
    const original = service[name] as (...a: unknown[]) => unknown;
    saved[name] = original;
    service[name] = (...a: unknown[]) => {
      calls[name] = (calls[name] ?? 0) + 1;
      return original(...a);
    };
  }
  return {
    calls,
    restore: () => Object.assign(service, saved),
  };
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

async function freshLabel(f: TestFacade) {
  return f.modules.labels.createLabel({ name: 'Fresh', kind: 'own' });
}

async function load(f: TestFacade, labelId: string, month: string, rows: { isrc: string; label: string }[]) {
  await f.ingestBelieve(
    writeBelieve(month, rows.map((r) => ({ isrc: r.isrc, upc: UPC, net: '10', labelName: r.label })), { account: ACC }),
    labelId,
  );
}

describe('the label checklist (D-172)', () => {
  it('an empty label: every step todo but the label itself and the information step', async () => {
    const f = await newFacade();
    const fresh = await freshLabel(f);
    const c = await f.labelChecklist(fresh.id);
    expect(c.label).toEqual({ id: fresh.id, name: 'Fresh' });
    expect(c.steps.map((s) => s.key)).toEqual(['label', 'accounts', 'files', 'unmapped', 'catalog', 'splits', 'owners', 'documents', 'publishing']);
    expect(states(c.steps)).toEqual({
      label: 'done',
      accounts: 'todo',
      files: 'todo',
      unmapped: 'todo',
      catalog: 'todo',
      splits: 'todo',
      owners: 'todo',
      documents: 'todo',
      publishing: 'info',
    });
    expect(c.steps.map((s) => s.count)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(c.steps.map((s) => s.link)).toEqual([
      `/labels/${fresh.id}`,
      `/labels/${fresh.id}`,
      '/sources',
      '/signals/labelUnmapped',
      '/tracks?catalog=current',
      '/tracks?hasSplit=no',
      '/artists?status=no_owner',
      '/splits?status=unconfirmed',
      '/publishing',
    ]);
  });

  it('after an account and files, splits, documents and the history: the counts and states move, no calculation', async () => {
    const f = await newFacade();
    const fresh = await freshLabel(f);
    await f.modules.labels.addAccount(fresh.id, ACC);
    await f.modules.labels.addAlias(fresh.id, 'Fresh Imprint');
    let c = await f.labelChecklist(fresh.id);
    expect(byKey(c.steps).accounts).toMatchObject({ state: 'done', count: 1 });
    expect(byKey(c.steps).files?.months).toEqual([{ account: ACC, first: null, last: null, gaps: [] }]);

    // files of 2026-01 and 2026-03 (a gap in 02); one string without an alias
    await load(f, fresh.id, '2026-01', [{ isrc: I(1), label: 'Fresh Imprint' }, { isrc: I(2), label: 'Nobody Knows' }]);
    await load(f, fresh.id, '2026-03', [{ isrc: I(1), label: 'Fresh Imprint' }]);
    const spy = await spyReads();
    restore = spy.restore;
    c = await f.labelChecklist(fresh.id);
    // reads only: no units, at most three ClickHouse reads (the registry is empty: no isrcsOfUpcs)
    expect(spy.calls).toEqual({ isrcFilePairs: 1, labelStringsOfFiles: 1 });
    spy.restore();
    restore = undefined;
    let s = byKey(c.steps);
    expect(s.files).toMatchObject({ state: 'todo', count: 2, counts: { files: 2, months: 2, gaps: 1 } });
    expect(s.files?.months).toEqual([{ account: ACC, first: '2026-01', last: '2026-03', gaps: ['2026-02'] }]);
    expect(s.unmapped).toMatchObject({ state: 'todo', count: 1, values: ['Nobody Knows'] });
    // the same strings as the signal labelUnmapped under the label (the signal reads only the units of known pairs:
    // the tracks are registered first)
    for (const n of [1, 2]) await f.modules.owners.createTrack({ title: `Onb ${n}`, isrc: I(n), upc: UPC, artistIds: [] });
    const signals = await f.signals({}, fresh.id);
    expect(signals.labelUnmapped.map((u) => u.labelName).sort()).toEqual(s.unmapped?.values);
    expect(s.catalog).toMatchObject({ state: 'todo', count: 2, counts: { isrcs: 2, withOpenInterval: 0, tracksWithoutLabel: 2, releases: 0, releasesIncomplete: 0 } });
    expect(s.splits).toMatchObject({ state: 'todo', count: 2 });
    expect(s.owners).toMatchObject({ state: 'todo', count: 0, counts: { pseudonyms: 0, withoutOwner: 0 } });
    expect(s.documents).toMatchObject({ state: 'todo', count: 0 });

    // splits: I(1) a row of a confirmed owner without a document and a pseudonym without an owner; I(2) none yet
    const { artists } = await confirmedOwner(f, 'Onboarding Owner', ['Onb A']);
    const orphan = await f.modules.owners.createArtist({ pseudonym: 'Onb Orphan' });
    const a = (artists[0] as { id: string }).id;
    await f.createSplit({ isrc: I(1), validFrom: '2020-01-01', shares: [{ artistId: a, percent: '40' }, { artistId: orphan.id, percent: '10' }], documentId: null });
    c = await f.labelChecklist(fresh.id);
    s = byKey(c.steps);
    expect(s.splits).toMatchObject({ state: 'todo', count: 1, counts: { isrcs: 2, withoutSplit: 1 } });
    expect(s.owners).toMatchObject({ state: 'todo', count: 1, counts: { pseudonyms: 2, withoutOwner: 1 } });
    // the confirmed owner's contract is of no label: it confirms under every label
    expect(s.documents).toMatchObject({ state: 'todo', count: 2, counts: { rows: 2, rowsWithoutDocument: 2, rowsUnapproved: 0, owners: 1, ownersWithoutContract: 0 } });

    // documents: an approved appendix on the split, an owner for the orphan without a contract; a split for I(2)
    const appendix = await approvedAppendix(f);
    const second = await confirmedOwner(f, 'Onboarding Second', ['Onb B']);
    const b = (second.artists[0] as { id: string }).id;
    const loose = await f.modules.owners.createOwner({ name: 'Onboarding Loose', kind: 'person' });
    await f.modules.owners.assignArtistOwner(orphan.id, loose.id);
    await f.changeSplit({ isrc: I(1), from: '2026-02-01', shares: [{ artistId: a, percent: '40' }, { artistId: orphan.id, percent: '10' }], documentId: appendix.id });
    await f.createSplit({ isrc: I(2), validFrom: '2020-01-01', shares: [{ artistId: b, percent: '50' }], documentId: appendix.id });
    c = await f.labelChecklist(fresh.id);
    s = byKey(c.steps);
    expect(s.splits).toMatchObject({ state: 'done', count: 0 });
    expect(s.owners).toMatchObject({ state: 'done', count: 0, counts: { pseudonyms: 3, withoutOwner: 0 } });
    // the first version of I(1) still has two rows without a document; the new owner has no contract
    expect(s.documents).toMatchObject({ state: 'todo', count: 3, counts: { rows: 5, rowsWithoutDocument: 2, rowsUnapproved: 0, owners: 3, ownersWithoutContract: 1 } });

    // the label history derived from the files: every ISRC has an interval of its last month
    await f.deriveTrackLabels({ apply: true });
    s = byKey((await f.labelChecklist(fresh.id)).steps);
    expect(s.catalog).toMatchObject({ state: 'done', count: 0, counts: { isrcs: 2, withOpenInterval: 2, tracksWithoutLabel: 0 } });

    // publishing: information, the statements of the label
    await f.ingestB17(await writeB17('2Q26', [{ title: 'Onb Song', writer: 'Onb Writer', payable: '5' }]), fresh.id);
    s = byKey((await f.labelChecklist(fresh.id)).steps);
    expect(s.publishing).toMatchObject({ state: 'info', count: 1, counts: { statements: 1, quarters: 1 } });
  });

  it('no label = 400 label_required; a sublabel 400 label_not_own; a viewer of another label 403', async () => {
    const f = await newFacade();
    await expect(f.labelChecklist(undefined)).rejects.toMatchObject({ code: 'label_required' });
    const sub = await f.modules.labels.createLabel({ name: 'Onb Sub', kind: 'sublabel', ownLabelId: f.testLabels['0to8'] });
    await expect(f.labelChecklist(sub.id)).rejects.toMatchObject({ code: 'label_not_own' });
    await expect(f.labelChecklist(f.testLabels.Echo8, labelsViewer([f.testLabels['0to8']]))).rejects.toMatchObject({ code: 'label_forbidden' });
    expect((await f.labelChecklist(f.testLabels['0to8'], labelsViewer([f.testLabels['0to8']]))).label.name).toBe('0to8');
  });
});

describe('the organization checklist (D-172)', () => {
  it('the facade counts labels and accounts; the members are an input', async () => {
    const f = await newFacade();
    const { steps } = await f.organizationChecklist({ members: 3, admins: 1 });
    expect(steps).toEqual([
      { key: 'org', state: 'done', count: 1, counts: {}, link: '/' },
      { key: 'labels', state: 'done', count: 2, counts: { own: 2, sublabels: 0 }, link: '/labels' },
      { key: 'users', state: 'done', count: 3, counts: { members: 3, admins: 1 }, link: '/users' },
      { key: 'accounts', state: 'done', count: 2, counts: { accounts: 2, ownWithoutAccount: 0 }, link: '/labels' },
    ]);
    await freshLabel(f);
    const again = byKey((await f.organizationChecklist({ members: 0, admins: 0 })).steps);
    expect(again.accounts).toMatchObject({ state: 'todo', counts: { accounts: 2, ownWithoutAccount: 1 } });
    expect(again.users).toMatchObject({ state: 'todo', count: 0 });
  });

  it('over HTTP: the administrator gets the members of the auth service; a label manager 403 on it, 400/403 on the label one', async () => {
    const f = await newFacade();
    const orgId = f.orgId;
    const stack = await testStack();
    await stack.reset();
    const suffix = randomUUID().slice(0, 8);
    const PASSWORD = randomBytes(12).toString('hex');
    const dataDir = join(TMP, `onboarding-${suffix}`);
    mkdirSync(dataDir, { recursive: true });
    const orgs = createOrgFacades({ stores: { db: stack.db, pool: stack.pg.pool, columnar: stack.columnar }, dataDir, payoutThresholdCents: 0 });
    const auth = createAuthService(stack.db);
    const admin = `onb-admin-${suffix}`;
    const manager = `onb-mgr-${suffix}`;
    await auth.createUser({ login: admin, password: PASSWORD, orgId, role: 'org_admin', createdBy: 'tests' });
    await auth.createUser({ login: manager, password: PASSWORD, orgId, role: 'label_manager', labelIds: [f.testLabels['0to8']], createdBy: 'tests' });
    const app = createServerApp({ orgs, auth: { service: auth, config: { mode: 'on', secret: randomBytes(32).toString('hex') } } });
    const signIn = async (login: string) => {
      const res = await request(app).post('/api/v1/auth/login').send({ login, password: PASSWORD }).expect(200);
      return ((res.headers['set-cookie'] as unknown as string[])[0] as string).split(';')[0] as string;
    };
    const asAdmin = await signIn(admin);
    const asManager = await signIn(manager);
    const get = (cookie: string, url: string) => request(app).get(`/api/v1${url}`).set('Cookie', cookie);
    const answer = (res: { status: number; body: { error?: { code?: string } } }) => `${res.status} ${res.body.error?.code ?? ''}`.trim();

    const members = (await auth.members(orgId)).filter((m) => m.active && !m.disabled);
    const org = (await get(asAdmin, '/onboarding/organization').expect(200)).body as { org: { id: string }; steps: Step[] };
    expect(org.org).toEqual({ id: orgId });
    expect(byKey(org.steps).users).toMatchObject({
      state: 'done',
      count: members.length,
      counts: { members: members.length, admins: members.filter((m) => m.role === 'org_admin').length },
    });
    expect(byKey(org.steps).users?.counts).toMatchObject({ members: expect.any(Number) as number });
    expect(members.length).toBeGreaterThanOrEqual(2);

    expect(answer(await get(asManager, '/onboarding/organization'))).toBe('403 forbidden');
    expect(answer(await get(asAdmin, '/onboarding'))).toBe('400 label_required');
    expect(answer(await get(asManager, '/onboarding'))).toBe('400 label_required');
    expect(answer(await get(asManager, `/onboarding?label=${f.testLabels.Echo8}`))).toBe('403 label_forbidden');
    const mine = (await get(asManager, `/onboarding?label=${f.testLabels['0to8']}`).expect(200)).body as { label: { name: string } };
    expect(mine.label.name).toBe('0to8');
  });
});
