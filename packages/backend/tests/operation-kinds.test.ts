import { afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { kindOf, OPERATION_KINDS } from '@erp/shared/operation-kinds';
import { createPostgres, postgresConfigFromEnv } from '../src/shared/postgres';
import { postgresMigrations } from '../src/shared/private-stores';
import { approvedDoc, confirmedOwner, newFacade, type TestFacade } from './helpers/fixtures';
import { postgresUp } from './helpers/stack';

// D-173 (stage 5 commit 1): the kind of an operation is stored. The migration 0019 derives it from the fields exactly
// as `meaningOf` did, replaces the rules of 0004 by rules per kind; the facade accepts `kind` for the five kinds of the
// history (the four kinds of the payroll got their facade behaviour in commit 2), the service branches by kind, the
// relabel needs a reason.

describe.runIf(postgresUp)('migration 0019_operation_kinds', () => {
  const config = postgresConfigFromEnv();
  const admin = createPostgres({ ...config, max: 1 });
  afterAll(() => admin.close());
  const m19 = () => postgresMigrations().find((m) => m.version === 19)?.text as string;

  async function database(upTo: number) {
    const name = `erp_t_m19_${randomBytes(4).toString('hex')}`;
    await admin.pool.query(`CREATE DATABASE ${name}`);
    const pg = createPostgres({ ...config, database: name, max: 1 });
    for (const m of postgresMigrations()) if (m.version <= upTo) await pg.pool.query(m.text);
    return {
      pg,
      async drop() {
        await pg.close();
        await admin.pool.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      },
    };
  }

  const INSERT = `INSERT INTO settlements.operations (org_id, id, direction, amount_cents, owner_id, artist_id, date, scope,
    document_id, payment_proof_id, operation_ref, migration, comment, label_id)
    VALUES ('o1', $1, $2, $3, $4, $5, '2026-01-01', $6, $7, $8, $9, $10, 'synthetic', $11)`;

  it('on a base with the five derived kinds: the kinds as meaningOf gave them, a second run changes nothing', async () => {
    const d = await database(18);
    try {
      const q = (text: string, values?: unknown[]) => d.pg.pool.query(text, values);
      const any = JSON.stringify({ kind: 'any' });
      await q(INSERT, ['pay', 'out', 1000, 'ow', 'ar', null, null, null, null, true, 'l1']);
      await q(INSERT, ['adv', 'out', 500, 'ow', 'ar', any, 'doc', 'proof', null, true, 'l1']);
      await q(INSERT, ['ded', 'in', 300, 'ow', 'ar', any, 'doc', null, null, false, null]);
      await q(INSERT, ['cre', 'in', -200, 'ow', 'ar', null, 'doc', null, null, false, 'l1']);
      await q(INSERT, ['ret', 'in', -100, 'ow', null, null, 'rp', null, 'pay', false, 'l1']);
      await q(m19());
      await q(m19());
      const rows = (await q('SELECT id, kind, label_source, area, channel FROM settlements.operations ORDER BY id')).rows;
      expect(rows).toEqual([
        { id: 'adv', kind: 'advance', label_source: null, area: 'master', channel: null },
        { id: 'cre', kind: 'credit', label_source: null, area: 'master', channel: null },
        { id: 'ded', kind: 'deduction', label_source: null, area: 'master', channel: null },
        { id: 'pay', kind: 'payout', label_source: null, area: 'master', channel: null },
        { id: 'ret', kind: 'return', label_source: null, area: 'master', channel: null },
      ]);
      // the SQL rule is the TypeScript rule on every combination of the fields
      for (const direction of ['in', 'out'] as const)
        for (const amountCents of [-5, 5])
          for (const scope of [null, any])
            for (const operationRef of [null, 'x']) {
              const sql = (
                await q('SELECT settlements.kind_of($1, $2, $3, $4) AS k', [direction, amountCents, scope, operationRef])
              ).rows[0].k as string;
              expect(sql, JSON.stringify({ direction, amountCents, scope, operationRef })).toBe(
                kindOf({ direction, amountCents, scope, operationRef }),
              );
            }
      const columns = (
        await q(`SELECT is_nullable FROM information_schema.columns
                 WHERE table_schema = 'settlements' AND table_name = 'operations' AND column_name = 'kind'`)
      ).rows;
      expect(columns).toEqual([{ is_nullable: 'NO' }]);
      expect((await q("SELECT to_regclass('settlements.operations_external_ref') IS NOT NULL AS ok")).rows[0].ok).toBe(true);
      expect((await q("SELECT 1 FROM information_schema.columns WHERE table_schema = 'publishing' AND table_name = 'pub_statements' AND column_name = 'replaced_by'")).rows).toHaveLength(1);

      // the rules per kind refuse a raw INSERT of every forbidden combination
      const raw = (id: string, kind: string, f: Record<string, unknown>) =>
        q(
          `INSERT INTO settlements.operations (org_id, id, kind, direction, amount_cents, owner_id, artist_id, date, scope,
             document_id, operation_ref, comment, area, label_source)
           VALUES ('o1', $1, $2, $3, $4, $5, $6, '2026-02-01', $7, $8, $9, 'raw', $10, $11)`,
          [id, kind, f.direction, f.amount, f.owner ?? null, f.artist ?? null, f.scope ?? null, f.doc ?? null, f.ref ?? null, f.area ?? 'master', f.source ?? null],
        );
      const refused: [string, Record<string, unknown>][] = [
        ['payout', { direction: 'out', amount: 1, owner: 'ow', scope: any }],
        ['payout', { direction: 'in', amount: 1, owner: 'ow' }],
        ['advance', { direction: 'out', amount: 1, owner: 'ow', artist: 'ar', scope: any }],
        ['deduction', { direction: 'in', amount: 1, artist: 'ar' }],
        ['credit', { direction: 'in', amount: -1, artist: 'ar', scope: any }],
        ['return', { direction: 'in', amount: -1, owner: 'ow' }],
        ['buyout', { direction: 'out', amount: 1, owner: 'ow' }],
        ['buyout', { direction: 'out', amount: 1, owner: 'ow', doc: 'd', scope: any }],
        ['forgiveness', { direction: 'in', amount: 1, doc: 'd' }],
        ['forgiveness', { direction: 'in', amount: -1, doc: 'd', ref: 'adv' }],
        ['writeoff', { direction: 'in', amount: 1, owner: 'ow', doc: 'd' }],
        ['writeoff', { direction: 'in', amount: 1, owner: 'ow', doc: 'd', area: 'publishing', scope: any }],
        ['adjustment', { direction: 'in', amount: -1, doc: 'd' }],
        ['adjustment', { direction: 'out', amount: 1, owner: 'ow', doc: 'd' }],
      ];
      for (const [i, [kind, f]] of refused.entries())
        await expect(raw(`bad${i}`, kind, f), `${kind} ${JSON.stringify(f)}`).rejects.toThrow(/operations_kind_rules/);
      await expect(raw('bad-kind', 'gift', { direction: 'out', amount: 1, owner: 'ow' })).rejects.toThrow(/operations_kind_check/);
      await expect(raw('bad-source', 'payout', { direction: 'out', amount: 1, owner: 'ow', source: 'guess' })).rejects.toThrow(
        /operations_label_source_check/,
      );
      await expect(raw('bad-area', 'payout', { direction: 'out', amount: 1, owner: 'ow', area: 'video' })).rejects.toThrow(/operations_area_check/);
      // and accepts every kind in its shape
      await raw('ok-buyout', 'buyout', { direction: 'out', amount: 1, owner: 'ow', doc: 'd' });
      await raw('ok-forgive', 'forgiveness', { direction: 'in', amount: 1, doc: 'd', ref: 'adv' });
      await raw('ok-writeoff', 'writeoff', { direction: 'in', amount: 1, owner: 'ow', doc: 'd', area: 'publishing' });
      await raw('ok-adjust', 'adjustment', { direction: 'in', amount: -1, owner: 'ow', doc: 'd', source: 'default' });
      expect(OPERATION_KINDS).toHaveLength(9);
    } finally {
      await d.drop();
    }
  });
});

/** A confirmed owner with one pseudonym, an advance basis and an adjustment basis of its own. */
async function world(f: TestFacade) {
  const { owner, artists } = await confirmedOwner(f, 'Kinds Owner Synthetic', ['Kinds']);
  const artistId = artists[0]?.id as string;
  const basis = (await approvedDoc(f, 'advance_basis', owner.id)).id;
  const adjust = (await approvedDoc(f, 'adjustment_basis', owner.id)).id;
  const label = f.testLabels['0to8'];
  const base = { amount: '10', date: '2026-03-01', comment: 'synthetic', labelId: label };
  return { owner, artistId, basis, adjust, label, base };
}

describe('operation kinds in the facade and the module (D-173)', () => {
  it('stores the kind (explicit or derived), keeps `meaning` as its alias and filters by kind', async () => {
    const f = await newFacade();
    const w = await world(f);
    const adv = await f.createOperation({ ...w.base, kind: 'advance', direction: 'out', artistId: w.artistId, scope: { kind: 'any' }, documentId: w.basis });
    const ded = await f.createOperation({ ...w.base, direction: 'in', artistId: w.artistId, documentId: w.adjust });
    const cre = await f.createOperation({ ...w.base, amount: '-3', kind: 'credit', direction: 'in', artistId: w.artistId });
    const pay = await f.createOperation({ ...w.base, kind: 'payout', direction: 'out', ownerId: w.owner.id, migration: true });
    expect([adv, ded, cre, pay].map((o) => [o.kind, o.meaning, o.labelSource, o.area])).toEqual([
      ['advance', 'recoupable_payout', 'operator', 'master'],
      ['deduction', 'deduction', 'operator', 'master'],
      ['credit', 'credit', 'operator', 'master'],
      ['payout', 'payout', 'operator', 'master'],
    ]);
    expect(ded.scope).toEqual({ kind: 'any' }); // the default scope of a deduction, as before
    const ret = await f.returnPayout(pay.id, { fileRef: 'dummy://r.pdf', date: '2026-03-02', comment: 'bounced' });
    expect([ret.kind, ret.meaning, ret.labelId, ret.labelSource]).toEqual(['return', 'return', w.label, 'payout']);
    // a scope given without an explicit kind to a credit is dropped as before; with the kind it is refused
    const legacy = await f.createOperation({ ...w.base, amount: '-1', direction: 'in', artistId: w.artistId, scope: { kind: 'any' } });
    expect([legacy.kind, legacy.scope]).toEqual(['credit', null]);
    const ids = async (filter: Parameters<typeof f.listOperations>[0]) => (await f.listOperations(filter)).map((o) => o.id).sort();
    expect(await ids({ kind: 'advance' })).toEqual([adv.id]);
    expect(await ids({ kind: 'credit' })).toEqual([cre.id, legacy.id].sort());
    expect(await ids({ labelSource: 'payout' })).toEqual([ret.id]);
    expect(await ids({ labelSource: null })).toEqual([]);
  });

  it('refuses in the order of D-173 §1.1 with the codes of §2', async () => {
    const f = await newFacade();
    const w = await world(f);
    const code = async (input: Parameters<typeof f.createOperation>[0]) => {
      try {
        await f.createOperation(input);
      } catch (e) {
        return { code: (e as { code?: string }).code, status: (e as { statusCode?: number }).statusCode, details: (e as { details?: unknown }).details };
      }
      return null;
    };
    const advance = { ...w.base, kind: 'advance' as const, direction: 'out' as const, artistId: w.artistId, scope: { kind: 'any' as const }, documentId: w.basis };
    expect(await code({ ...advance, labelId: null })).toMatchObject({ code: 'label_required', status: 400 });
    expect(await code({ ...advance, direction: 'in' })).toMatchObject({ code: 'kind_direction', status: 400, details: { kind: 'advance', expected: 'out' } });
    expect(await code({ ...advance, amount: '-10' })).toMatchObject({ code: 'kind_sign', status: 400 });
    expect(await code({ ...w.base, kind: 'deduction', direction: 'in', amount: '-1', artistId: w.artistId })).toMatchObject({ code: 'kind_sign' });
    expect(await code({ ...w.base, kind: 'credit', direction: 'in', amount: '1', artistId: w.artistId })).toMatchObject({ code: 'kind_sign' });
    expect(await code({ ...w.base, kind: 'payout', direction: 'out', ownerId: w.owner.id })).toMatchObject({ code: 'use_payout_button', status: 422 });
    expect(await code({ ...w.base, direction: 'out', ownerId: w.owner.id })).toMatchObject({ code: 'use_payout_button' }); // derived, as before
    expect(await code({ ...w.base, kind: 'return', direction: 'in', amount: '-1', operationRef: 'x' })).toMatchObject({ code: 'use_return_action', status: 400 });
    expect(await code({ ...w.base, amount: '-1', direction: 'in', operationRef: 'x' })).toMatchObject({ code: 'use_return_action' });
    expect(await code({ ...w.base, kind: 'forgiveness', direction: 'in', operationRef: 'x' })).toMatchObject({ code: 'use_forgive_action', status: 400 });
    expect(await code({ ...w.base, kind: 'payout', direction: 'out', migration: true, labelId: null })).toMatchObject({ code: 'owner_required', status: 400 });
    expect(await code({ ...advance, artistId: null, ownerId: w.owner.id })).toMatchObject({ code: 'artist_required', status: 400 });
    expect(await code({ ...w.base, kind: 'deduction', direction: 'in', ownerId: w.owner.id })).toMatchObject({ code: 'artist_required' });
    expect(await code({ ...advance, scope: null })).toMatchObject({ code: 'scope_required', status: 400 });
    expect(await code({ ...w.base, kind: 'credit', direction: 'in', amount: '-1', artistId: w.artistId, scope: { kind: 'any' } })).toMatchObject({
      code: 'scope_forbidden',
      status: 400,
    });
    expect(await code({ ...advance, documentId: null })).toMatchObject({ code: 'document_required', status: 422 });
    expect(await code({ ...advance, documentId: w.adjust })).toMatchObject({ code: 'document_kind', status: 400, details: { allowed: ['advance_basis', 'contract'] } });
    expect(await code({ ...w.base, kind: 'deduction', direction: 'in', artistId: w.artistId, documentId: w.basis })).toMatchObject({ code: 'document_kind' });
    const stranger = (await approvedDoc(f, 'advance_basis', (await f.modules.owners.createOwner({ name: 'Stranger Synthetic', kind: 'person' })).id)).id;
    expect(await code({ ...advance, documentId: stranger })).toMatchObject({ code: 'document_owner_mismatch' });
    // the kinds of the payroll (D-173 commit 2): to an owner, with a basis document of their kind, a write-off publishing
    expect(await code({ ...w.base, kind: 'buyout', direction: 'out' })).toMatchObject({ code: 'owner_required', status: 400 });
    expect(await code({ ...w.base, kind: 'adjustment', direction: 'in', amount: '-1' })).toMatchObject({ code: 'owner_required' });
    expect(await code({ ...w.base, kind: 'buyout', direction: 'out', ownerId: w.owner.id, scope: { kind: 'any' } })).toMatchObject({ code: 'scope_forbidden' });
    expect(await code({ ...w.base, kind: 'writeoff', direction: 'in', ownerId: w.owner.id, area: 'master', documentId: w.adjust })).toMatchObject({ code: 'writeoff_area', status: 400 });
    expect(await code({ ...w.base, kind: 'buyout', direction: 'out', ownerId: w.owner.id })).toMatchObject({ code: 'document_required', status: 422 });
    expect(await code({ ...w.base, kind: 'buyout', direction: 'out', ownerId: w.owner.id, documentId: w.adjust })).toMatchObject({ code: 'document_kind', details: { allowed: ['buyout'] } });
    expect(await code({ ...w.base, kind: 'adjustment', direction: 'in', ownerId: w.owner.id, documentId: w.basis })).toMatchObject({ code: 'document_kind' });
    expect(await code({ ...w.base, kind: 'writeoff', direction: 'in', ownerId: w.owner.id, documentId: w.adjust })).toMatchObject({
      code: 'writeoff_exceeds',
      status: 422,
      details: { available: '0' },
    });
    expect(await code({ ...w.base, kind: 'adjustment', direction: 'in', amount: '-1', ownerId: w.owner.id, documentId: w.adjust })).toBeNull();
    expect(await code(advance)).toBeNull();
  });

  it('the module holds the shape of the four payroll kinds and branches by kind (FIX-4)', async () => {
    const f = await newFacade();
    const w = await world(f);
    const s = f.modules.settlements;
    const buyoutDoc = (await approvedDoc(f, 'buyout', w.owner.id)).id;
    const common = { amountCents: 1000, date: '2026-04-01', comment: 'synthetic', labelId: w.label, labelSource: 'operator' as const };
    const buyout = await s.createOperation({ ...common, kind: 'buyout', direction: 'out', ownerId: w.owner.id, documentId: buyoutDoc });
    expect([buyout.kind, buyout.meaning, buyout.scope]).toEqual(['buyout', 'payout', null]);
    await expect(s.createOperation({ ...common, kind: 'buyout', direction: 'out', ownerId: w.owner.id })).rejects.toMatchObject({ code: 'document_required' });
    const writeoff = await s.createOperation({ ...common, kind: 'writeoff', direction: 'in', ownerId: w.owner.id, documentId: w.adjust });
    expect(writeoff.area).toBe('publishing');
    await expect(
      s.createOperation({ ...common, kind: 'writeoff', direction: 'in', ownerId: w.owner.id, documentId: w.adjust, area: 'master' }),
    ).rejects.toMatchObject({ code: 'writeoff_area' });
    await expect(
      s.createOperation({ ...common, kind: 'writeoff', direction: 'in', ownerId: w.owner.id, documentId: w.adjust, scope: { kind: 'publishing' } }),
    ).rejects.toMatchObject({ code: 'scope_forbidden' });
    const adjustment = await s.createOperation({ ...common, amountCents: -1755, kind: 'adjustment', direction: 'in', ownerId: w.owner.id, documentId: w.adjust });
    expect(adjustment.kind).toBe('adjustment');
    await expect(s.createOperation({ ...common, kind: 'adjustment', direction: 'in', documentId: w.adjust })).rejects.toMatchObject({ code: 'owner_required' });
    // a return refers to a payout, never to a buyout (out without scope before D-173)
    await expect(
      s.createOperation({ ...common, amountCents: -1000, kind: 'return', direction: 'in', operationRef: buyout.id }),
    ).rejects.toThrow(/refers to a payout/);
    // a forgiveness refers to an active advance and takes its owner, pseudonym and label
    const adv = await f.createOperation({ amount: '50', date: '2026-01-01', comment: 'advance', labelId: w.label, kind: 'advance', direction: 'out', artistId: w.artistId, scope: { kind: 'any' }, documentId: w.basis });
    await expect(
      s.createOperation({ ...common, kind: 'forgiveness', direction: 'in', operationRef: buyout.id, documentId: w.adjust }),
    ).rejects.toMatchObject({ code: 'operation_ref_not_advance' });
    const forgiven = await s.createOperation({ ...common, amountCents: 3000, kind: 'forgiveness', direction: 'in', operationRef: adv.id, documentId: w.adjust, labelId: null });
    expect([forgiven.ownerId, forgiven.artistId, forgiven.labelId, forgiven.labelSource]).toEqual([w.owner.id, w.artistId, w.label, 'payout']);
    // deactivate: an advance with an active forgiveness is refused (has_forgiveness), not has_returns
    await expect(f.deactivateOperation(adv.id, 'mistake')).rejects.toMatchObject({ code: 'has_forgiveness', statusCode: 409 });
    await f.deactivateOperation(forgiven.id, 'mistake');
    // payout_sent / payout_paid belong to a payout: an advance with an external reference is deactivated plainly
    await s.setExternalRef(adv.id, 'ext-adv');
    expect((await f.deactivateOperation(adv.id, 'mistake')).active).toBe(false);
    // a payout with an active return: has_returns
    const pay = await f.createOperation({ amount: '20', date: '2026-02-01', comment: 'migrated', labelId: w.label, kind: 'payout', direction: 'out', ownerId: w.owner.id, migration: true });
    await f.returnPayout(pay.id, { fileRef: 'dummy://r.pdf', date: '2026-02-02', comment: 'bounced' });
    await expect(f.deactivateOperation(pay.id, 'mistake')).rejects.toMatchObject({ code: 'has_returns' });
    // a buyout takes a payment proof and may be deferred (it never blocks)
    expect((await s.setDeferred(buyout.id, true)).deferred).toBe(true);
  });

  it('only payouts and advances block new payouts: a buyout without a proof never does (FIX-5)', async () => {
    const f = await newFacade();
    const w = await world(f);
    const s = f.modules.settlements;
    const buyoutDoc = (await approvedDoc(f, 'buyout', w.owner.id)).id;
    const buyout = await s.createOperation({ kind: 'buyout', direction: 'out', amountCents: 100000, ownerId: w.owner.id, documentId: buyoutDoc, date: '2026-04-01', comment: 'buyout', labelId: w.label });
    expect(buyout.paymentProofId).toBeNull();
    expect(await s.blockingPayouts(w.owner.id)).toEqual([]);
    // the advance gate of createOperation (context.ts blockingPayoutsOf) lets the advance through
    const advance = { amount: '10', date: '2026-04-02', comment: 'advance', labelId: w.label, kind: 'advance' as const, direction: 'out' as const, artistId: w.artistId, scope: { kind: 'any' as const }, documentId: w.basis };
    const adv = await f.createOperation(advance);
    // that advance has no proof: now it blocks, in the module and in the gate
    expect((await s.blockingPayouts(w.owner.id)).map((o) => o.id)).toEqual([adv.id]);
    await expect(f.createOperation(advance)).rejects.toMatchObject({ code: 'payout_blocked', details: { operationIds: [adv.id] } });
  });

  it('the relabel needs a reason, marks the source operator and answers the previous label; the default list', async () => {
    const f = await newFacade();
    const w = await world(f);
    const zero = f.testLabels['0to8'];
    const echo = f.testLabels.Echo8;
    const ded = await f.createOperation({ ...w.base, direction: 'in', artistId: w.artistId });
    await expect(f.setOperationLabel(ded.id, echo, undefined)).rejects.toMatchObject({ code: 'reason_required', statusCode: 400 });
    await expect(f.setOperationLabel(ded.id, echo, ' ')).rejects.toMatchObject({ code: 'reason_required' });
    const moved = await f.setOperationLabel(ded.id, echo, 'paid by Echo8');
    expect([moved.labelId, moved.fromLabelId, moved.labelSource]).toEqual([echo, zero, 'operator']);
    // the marking script sets the source without touching the label; the signal lists the default ones
    await f.modules.settlements.setLabelSource(ded.id, 'default');
    const all = await f.signals();
    expect(all.operationsDefaultLabel.map((o) => [o.operationId, o.kind, o.labelId, o.pseudonym])).toEqual([[ded.id, 'deduction', echo, 'Kinds']]);
    expect(all.counts.operationsDefaultLabel).toBe(1);
    expect((await f.signals({}, echo)).operationsDefaultLabel).toHaveLength(1);
    expect((await f.signals({}, zero)).operationsDefaultLabel).toHaveLength(0);
    // the facade relabel writes no audit row (the API hook does): the counter stays 0 here
    expect(all.operationsRelabelled).toBe(0);
  });
});
