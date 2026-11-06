import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { payoutSnapshotSchema } from '@erp/shared/api-responses';
import { createApp } from '../src/api/app';
import { operationOf } from '../src/api/operations';
import { can, principalOfUser } from '../src/auth/abilities';
import { normalizeName } from '../src/shared/identifiers';
import { confirmedOwner, newFacade, TMP, writeB17 } from './helpers/fixtures';
import { writer } from './helpers/writer';

// The replacement of a B17 statement (D-173 stage 5 commit 5, closes D-041 ⚠ by a mechanism): one module transaction,
// the old statement `superseded` with its lines, its quarters re-pointed, the grouped lines refreshed. Synthetic data only.

type F = Awaited<ReturnType<typeof newFacade>>;

const sum = (xs: { payablePico: bigint }[]) => xs.reduce((s, x) => s + x.payablePico, 0n);
const PICO = 1_000_000_000_000n;

async function world() {
  const f = await newFacade();
  const zero = f.testLabels['0to8'] as string;
  const echo = f.testLabels['Echo8'] as string;
  const { owner, contractDocId } = await confirmedOwner(f, 'Replace Owner', ['Replace Synth']);
  // Q1 under 0to8 apart: a replacement of Q2 never touches it
  const q1 = await f.ingestB17(await writeB17('Q12026', [{ writer: 'Holder Q1', title: 'Q1', payable: '4', period: '1Q26' }]), zero);
  const v1 = await f.ingestB17(
    await writeB17('Q22026', [
      { writer: 'Replace Writer', title: 'Song', payable: '100' },
      { writer: 'Other Holder', title: 'T', payable: '10' },
    ]),
    zero,
  );
  await f.modules.publishing.mapWriter(normalizeName('Replace Writer'), owner.id, 'manual');
  await f.setPublishingTerms({ ownerId: owner.id, percent: '50', validFrom: '2020-01-01', documentId: contractDocId });
  const app = createApp(f, { tmpDir: join(TMP, 'b17-replace-uploads') });
  return { f, zero, echo, owner, q1: q1.statement, v1: v1.statement, app };
}

/** The corrected Q2 file: the owner's line grows to 160, a new holder appears. */
const corrected = () =>
  writeB17(
    'Q22026',
    [
      { writer: 'Replace Writer', title: 'Song', payable: '160' },
      { writer: 'Other Holder', title: 'T', payable: '10' },
      { writer: 'Fresh Holder', title: 'U', payable: '5' },
    ],
    '0to8_Q22026_Publishing_Statement_Updated.xlsx',
  );

const replaceUrl = (id: string) => `/api/v1/publishing/statements/${id}/replace`;

async function linesOf(f: F, statementId: string) {
  const r = await f.db.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM publishing.pub_lines WHERE statement_id = $1', [statementId]);
  return Number(r.rows[0]?.n);
}

describe('B17 statement replacement (D-173)', () => {
  it('supersedes the old statement in one step: lines kept, quarters re-pointed, the view and the reconciliation follow, the payout snapshot unchanged', async () => {
    const { f, zero, owner, q1, v1, app } = await world();
    const b17Row = async () => (await f.reconciliation()).find((r) => r.source === 'b17' && r.month === '2026-06');
    expect((await b17Row())?.A_received.toFixed()).toBe('110');
    // the button pays the whole book with area 'all' (D-173 О6)
    const payout = await f.createPayout(owner.id, { labelId: zero, area: 'all' });
    expect(payout.amountCents).toBe(5000);
    const before = JSON.stringify(await f.modules.settlements.getSnapshot(payout.id));
    const snapshotApi = (await writer(app).get(`/api/v1/settlements/operations/${payout.id}/snapshot`).expect(200)).body as unknown;
    expect(payoutSnapshotSchema.safeParse(snapshotApi).success).toBe(true);

    const file = await corrected();
    const res = await writer(app).post(replaceUrl(v1.id)).query({ label: zero }).attach('file', file.path, file.fileName);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const body = res.body as { superseded: { id: string; status: string; sha256: string; replacedBy: string | null }; statement: { id: string; status: string; replacedBy: string | null; periods: string[]; labelId: string; totalPayable: string }; writers: Record<string, number> };
    expect([body.superseded.id, body.superseded.status, body.superseded.sha256]).toEqual([v1.id, 'superseded', v1.sha256]);
    expect([body.superseded.replacedBy, body.statement.replacedBy]).toEqual([body.statement.id, null]);
    expect([body.statement.status, body.statement.periods, body.statement.labelId, body.statement.totalPayable]).toEqual([
      'loaded',
      ['2026-Q2'],
      zero,
      '175',
    ]);
    expect(Object.keys(body.writers).sort()).toEqual(['ambiguous', 'created', 'external', 'matched']);
    const newId = body.statement.id;

    // the old lines stay, the quarter belongs to the new statement, the other quarter is untouched
    expect([await linesOf(f, v1.id), await linesOf(f, newId)]).toEqual([2, 3]);
    const periods = await f.db.query<{ period: string; statement_id: string }>(
      'SELECT period, statement_id FROM publishing.pub_statement_periods ORDER BY period',
    );
    expect(periods.rows.map((r) => [r.period, r.statement_id])).toEqual([
      ['2026-Q1', q1.id],
      ['2026-Q2', newId],
    ]);
    // a superseded statement is out of the active list and of the grouped lines
    expect((await f.modules.publishing.activeStatements()).map((s) => s.id).sort()).toEqual([q1.id, newId].sort());
    const { lines } = await f.modules.publishing.snapshotForCalculation();
    expect([sum(lines.filter((l) => l.period === '2026-Q2')), sum(lines.filter((l) => l.period === '2026-Q1'))]).toEqual([175n * PICO, 4n * PICO]);
    // the reconciliation row of the quarter has the new totals
    expect((await b17Row())?.A_received.toFixed()).toBe('175');
    // the writers of the new file are registered by the same load
    expect((await f.modules.publishing.listWriters()).some((w) => w.writerNorm === normalizeName('Fresh Holder'))).toBe(true);
    // GET /sources/files shows both, the old one superseded
    const files = (await writer(app).get('/api/v1/sources/files').expect(200)).body as { b17: { id: string; status: string }[] };
    expect(files.b17.map((s) => [s.id, s.status])).toEqual(
      expect.arrayContaining([
        [v1.id, 'superseded'],
        [newId, 'loaded'],
        [q1.id, 'loaded'],
      ]),
    );
    // the payout snapshot made before the replacement is byte for byte the same
    expect(JSON.stringify(await f.modules.settlements.getSnapshot(payout.id))).toBe(before);
    expect((await writer(app).get(`/api/v1/settlements/operations/${payout.id}/snapshot`).expect(200)).body).toEqual(snapshotApi);
    // the owner's publishing is half of the new 160
    expect((await f.ownerBalance(owner.id)).total.earned.toFixed()).toBe('80');

    // the audit row from the response: the old and the new statement, the quarters, the label of the query
    const audit = (await writer(app).get('/api/v1/audit').query({ limit: '5' }).expect(200)).body as {
      items: { route: string; entityIds: string[]; summary: { body: Record<string, unknown> }; labelId: string | null }[];
    };
    const row = audit.items[0];
    expect(row?.route).toBe('/publishing/statements/:id/replace');
    expect(row?.entityIds).toEqual(expect.arrayContaining([v1.id, newId]));
    expect(row?.summary.body).toEqual({ superseded: v1.id, statement: newId, periods: ['2026-Q2'] });
    expect(row?.labelId).toBe(zero);
  });

  it('refuses: not loaded, another label, other quarters, the same file, an unknown statement, no label', async () => {
    const { f, zero, echo, v1, app } = await world();
    const post = (id: string, label: string | undefined, file: { path: string; fileName: string }) => {
      const t = writer(app).post(replaceUrl(id));
      return (label ? t.query({ label }) : t).attach('file', file.path, file.fileName);
    };
    const code = (r: { status: number; body: { error?: { code?: string } } }) => `${r.status} ${r.body.error?.code ?? ''}`;
    const file = await corrected();
    // the label before the body: none, unknown
    expect(code(await post(v1.id, undefined, file))).toBe('400 label_required');
    // another own label than the statement's
    expect(code(await post(v1.id, echo, file))).toBe('409 replace_label_differs');
    // the quarters of the new file differ (as sets): a file of Q2 and Q3 (no quarter in the name)
    const wider = await writeB17(
      'x',
      [
        { writer: 'Replace Writer', title: 'Song', payable: '160', period: '2Q26' },
        { writer: 'Replace Writer', title: 'Song', payable: '1', period: '3Q26' },
      ],
      'Corrected_Statement.xlsx',
    );
    const differ = await post(v1.id, zero, wider);
    expect(code(differ)).toBe('409 periods_differ');
    expect(differ.body.error.details).toEqual({ old: ['2026-Q2'], new: ['2026-Q2', '2026-Q3'] });
    // nothing changed by the refusals
    expect((await f.modules.publishing.getStatement(v1.id)).status).toBe('loaded');
    const done = await post(v1.id, zero, file);
    expect(done.status).toBe(201);
    const newId = (done.body as { statement: { id: string } }).statement.id;
    // the same bytes as the loaded statement
    expect(code(await post(newId, zero, file))).toBe('409 duplicate_file');
    // the superseded statement is not replaced again
    expect(code(await post(v1.id, zero, await corrected()))).toBe('409 replace_not_loaded');
    expect(code(await post('no-such-statement', zero, file))).toBe('404 not_found');
    // a refusal leaves the lines and the quarters as they were
    expect(await linesOf(f, newId)).toBe(3);
    expect((await f.modules.publishing.activeStatements()).some((s) => s.id === newId)).toBe(true);
  });

  it('is an approve operation: a label manager is refused even under the own label', () => {
    const op = operationOf('POST', '/publishing/statements/x/replace');
    expect(op?.ability).toEqual({ action: 'approve', subject: 'publishing', scope: 'label' });
    const manager = principalOfUser({
      id: 'u',
      login: 'mgr',
      isSystemAdmin: false,
      orgId: 'o',
      role: 'label_manager',
      labelIds: ['L'],
      sessionId: 's',
    });
    expect(can(manager, op!.ability!, { labelIds: ['L'] })).toEqual({ ok: false, status: 403, code: 'forbidden' });
    // the upload stays write: the manager loads under the own label
    expect(can(manager, operationOf('POST', '/publishing/b17')!.ability!, { labelIds: ['L'] })).toEqual({ ok: true });
  });
});
