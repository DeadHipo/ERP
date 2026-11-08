/**
 * The start of 15.10 becomes a cut (D-203). Reads the active opening balance rows of a label (one cut: their
 * `cutoff_month` and `synced_at` day) and, per owner with rows, compares every position (a pseudonym's or the owner's
 * own, per area) at the cut WITH the start and WITHOUT it (the label's own history up to the cut). The plan:
 *  - a reconciling `adjustment` per position whose difference is a cent or more (amount = without − with, rounded half
 *    up to cents: a positive adjustment lowers the position, D-173), dated the cut's day and attributed to the cut;
 *  - a `forgiveness` of what our history leaves unrecouped of every advance of the book inside the start (not reopened
 *    by `operation_ref`), dated the first day after the bounds (or the advance's own date), rounded down to cents: the
 *    cabinet's number holds that debt, so the later income must not be recouped by it again (outside payable, the cut
 *    does not move);
 *  - a blocking hold `question` for every owner with a `missing` row (the gate `start_missing` closed the payout);
 *  - every start row of the label deactivated.
 * The plan is simulated in memory first (no start, plus those rows): every position at the cut and now, and the
 * book's `payableShown`, must stay within the tolerance (2 cents: the sub-cent rests of the forgivenesses and of the
 * rounding). `--apply` writes it in ONE transaction and repeats the comparison on the written data inside it; any
 * position out of the tolerance rolls everything back. Needs the cut (`--cut`, default «Кабинет 15.10») with the
 * start's bounds. Idempotent: without active start rows there is nothing to do.
 *
 * The forgiveness is written through the settlements module, not `forgiveAdvance`: its check `forgiveness_exceeds`
 * reads the unrecouped part now, and the migration forgives the part at the bound (a migration-only bypass, D-203).
 *
 * `--deductions-as-debt` (D-204) migrates those owners too: the deduction is not forgiven and stays a debt recouped
 * from the later income (the simulation still requires the positions at the cut and now to stay).
 *
 *   npx tsx packages/backend/scripts/start/start-to-cut.ts [--label 0to8] [--cut «Кабинет 15.10»] [--deductions-as-debt] [--apply] [--org <id>] [dataDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openFacade } from '../../src/facade';
import { pubV2Source } from '../../src/facade/pubv2-source';
import { connectOrg, takeOrgArgument } from '../../src/connect-sources';
import { calculate, type Calculation } from '../../src/facade/calculation';
import { ownerBalance, ownerIndex, type OwnerBalance } from '../../src/facade/balance';
import { cutCalculationBy, cutOperationsBy, type CutBounds } from '../../src/facade/as-of';
import { Decimal, ZERO } from '../../src/shared/money';
import type { CutView, OpeningBalanceView, OperationView } from '../../src/modules/settlements';

const ORG = takeOrgArgument();
const args = process.argv.slice(2);
const VALUED = ['--label', '--cut'];
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const labelName = opt('--label') ?? '0to8';
const cutName = opt('--cut') ?? 'Кабинет 15.10';
const apply = args.includes('--apply');
/** The owner's decision of 2026-11-08 (D-204): a deduction left unrecouped stays a debt beyond the cabinet; its owner migrates too. */
const deductionsAsDebt = args.includes('--deductions-as-debt');
const dataDirArg = args.filter((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1] ?? ''))[0];
const root = resolve(import.meta.dirname, '..', '..', '..', '..');
const dataDir = resolve(dataDirArg ?? join(root, 'data'));

const AREAS = ['master', 'publishing'] as const;
type Area = (typeof AREAS)[number];
const TOLERANCE = new Decimal('0.02');
const SIM_DOC = 'sim-doc';
const REF = 'start-to-cut:';
const OPERATOR = 'start-to-cut';

/** Every position of the owner in the book L, per area (key `<artistId|''>/<area>`), and the book's payableShown. */
function positionsOf(b: OwnerBalance, labelId: string): Map<string, Decimal> {
  const out = new Map<string, Decimal>();
  for (const a of b.artists) {
    const book = Object.values(a.byLabel).find((x) => x.labelId === labelId);
    if (book) for (const area of AREAS) out.set(`${a.artistId}/${area}`, book.positionByArea[area]);
  }
  const book = Object.values(b.byLabel).find((x) => x.labelId === labelId);
  if (book) {
    for (const area of AREAS) out.set(`/${area}`, book.byArea[area].ownerPosition);
    out.set('payableShown', book.payableShown);
  }
  return out;
}

/** The lines where two states differ by the tolerance or more. */
function differences(ownerId: string, when: string, a: Map<string, Decimal>, b: Map<string, Decimal>): string[] {
  const out: string[] = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key) ?? ZERO;
    const y = b.get(key) ?? ZERO;
    if (x.minus(y).abs().gte(TOLERANCE)) out.push(`${ownerId},${key},${when},${x.toFixed()},${y.toFixed()},${y.minus(x).toFixed()}`);
  }
  return out;
}

const maxDelta = (a: Map<string, Decimal>, b: Map<string, Decimal>) =>
  [...new Set([...a.keys(), ...b.keys()])].reduce((m, k) => Decimal.max(m, (a.get(k) ?? ZERO).minus(b.get(k) ?? ZERO).abs()), ZERO);

interface Adjustment { ownerId: string; artistId: string | null; area: Area; amount: Decimal; exact: Decimal }
interface Forgiveness { ownerId: string; advance: OperationView; date: string; amount: Decimal; exact: Decimal }
interface OwnerPlan { ownerId: string; missing: boolean; atCut: Map<string, Decimal>; now: Map<string, Decimal> }

const stack = await connectOrg({ dataDir, org: ORG });
const f = openFacade({ db: stack.db, orgId: stack.orgId, dataDir, payoutThresholdCents: 5000, sources: stack.sources });
try {
  const { settlements } = f.modules;
  const label = (await f.modules.labels.index()).ownLabels().find((l) => l.name === labelName);
  if (!label) throw new Error(`no own label named ${labelName}`);
  const publishing = process.env.PUBLISHING_SOURCE === 'v2' ? pubV2Source(stack.db, f.modules.publishing, f.modules) : f.modules.publishing;
  const modules = { ...f.modules, publishing, db: stack.db };
  const view = { labelId: label.id };

  /** One read of the world: the start rows, the operations by owner, the cuts and one full calculation. */
  const readWorld = async () => {
    const read = await stack.db.snapshot(async () => ({
      rows: (await settlements.listOpeningBalances({ labelId: label.id, active: true })).filter((r) => r.active),
      ops: await settlements.listOperations({}),
      cuts: await settlements.listCuts({ labelId: label.id }),
      docIds: (await settlements.allOperations()).flatMap((o) => [o.documentId, o.paymentProofId].filter((x): x is string => !!x)),
    }));
    const calc = await calculate(modules, read.docIds);
    const opsOf = new Map<string, OperationView[]>();
    for (const o of read.ops) if (o.ownerId) (opsOf.get(o.ownerId) ?? opsOf.set(o.ownerId, []).get(o.ownerId))?.push(o);
    return { ...read, calc, opsOf };
  };

  const t0 = performance.now();
  const w = await readWorld();
  console.log(`full calculation: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (w.rows.length === 0) {
    console.log(`no active start rows in ${labelName}: nothing to do`);
    process.exit(0);
  }
  const cutoffs = new Set(w.rows.map((r) => r.cutoffMonth));
  const days = new Set(w.rows.map((r) => r.syncedAt.slice(0, 10)));
  if (cutoffs.size !== 1 || days.size !== 1) throw new Error(`the start rows have several cuts: ${[...cutoffs]} / ${[...days]}`);
  const cutoff = [...cutoffs][0] as string; // 'YYYY-MM'
  const cutDate = [...days][0] as string;
  const [y, m] = cutoff.split('-').map(Number) as [number, number];
  const to = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const cut: CutView | undefined = w.cuts.find((c) => c.name === cutName);
  if (cut && (cut.cutDate !== cutDate || cut.masterTo !== to || cut.publishingTo !== to || cut.adsTo !== to))
    throw new Error(`the cut «${cutName}» has other bounds than the start (${cut.cutDate}, ${cut.masterTo}/${cut.publishingTo}/${cut.adsTo})`);
  if (apply && !cut) throw new Error(`no cut «${cutName}» of ${labelName}: create it with the start's bounds first`);
  const cutId = cut?.id ?? 'sim-cut';
  const boundsOf = (cuts: CutView[]): CutBounds => {
    const dates = new Map(cuts.map((c) => [c.id, c.cutDate]));
    return { masterTo: to, publishingTo: to, adsTo: to, date: cutDate, cutDateOf: (id) => (id === 'sim-cut' ? cutDate : dates.get(id)) };
  };
  const bounds = boundsOf(w.cuts);
  console.log(`label ${labelName}: ${w.rows.length} active rows (start ${w.rows.filter((r) => r.kind === 'start').length}, adjustment ${w.rows.filter((r) => r.kind === 'adjustment').length}, missing ${w.rows.filter((r) => r.missing).length}, reopened advances ${w.rows.filter((r) => r.operationRef).length})`);
  console.log(`the cut: ${cut ? `«${cut.name}» ` : '(not created yet) '}date ${cutDate}, every bound ${to} (cutoff month ${cutoff})`);

  const startsOf = new Map<string, OpeningBalanceView[]>();
  for (const r of w.rows) {
    const ownerId = w.calc.artistIndex.get(r.artistId)?.ownerId;
    if (!ownerId) throw new Error(`start row ${r.id}: the pseudonym has no owner`);
    (startsOf.get(ownerId) ?? startsOf.set(ownerId, []).get(ownerId))?.push(r);
  }

  // ---- the plan ----
  const cutCalc = cutCalculationBy(w.calc, bounds);
  const idxCut = ownerIndex(cutCalc);
  const idxNow = ownerIndex(w.calc);
  const plans: OwnerPlan[] = [];
  const adjustments: Adjustment[] = [];
  const forgivenesses: Forgiveness[] = [];
  /** Positions of other kinds (a deduction) left unrecouped at the bound: their owners stay on the start. */
  const exempt: string[] = [];
  const exemptOwners = new Set<string>();
  for (const [ownerId, starts] of startsOf) {
    const own = w.opsOf.get(ownerId) ?? [];
    const atCutOps = cutOperationsBy(own, bounds);
    const iCut = idxCut.get(ownerId) ?? { units: [], publishing: [] };
    const iNow = idxNow.get(ownerId) ?? { units: [], publishing: [] };
    const withAt = positionsOf(ownerBalance(cutCalc, ownerId, atCutOps, {}, { ...iCut, starts }, view), label.id);
    const withoutAtB = ownerBalance(cutCalc, ownerId, atCutOps, {}, { ...iCut, starts: [] }, view);
    const withoutAt = positionsOf(withoutAtB, label.id);
    const now = positionsOf(ownerBalance(w.calc, ownerId, own, {}, { ...iNow, starts }, view), label.id);
    const mine: { adjustments: Adjustment[]; forgivenesses: Forgiveness[]; others: string[] } = { adjustments: [], forgivenesses: [], others: [] };
    for (const key of new Set([...withAt.keys(), ...withoutAt.keys()])) {
      if (key === 'payableShown') continue;
      const exact = (withoutAt.get(key) ?? ZERO).minus(withAt.get(key) ?? ZERO);
      const amount = exact.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      if (amount.isZero()) continue;
      const [artistId, area] = key.split('/') as [string, Area];
      mine.adjustments.push({ ownerId, artistId: artistId || null, area, amount, exact });
    }
    const kept = new Set(starts.map((r) => r.operationRef).filter((x): x is string => !!x));
    const byId = new Map(own.map((o) => [o.id, o]));
    for (const p of withoutAtB.positions) {
      const op = byId.get(p.operationId);
      if (!op || !op.active || op.labelId !== label.id || kept.has(op.id) || op.date.slice(0, 10) > cutDate) continue;
      if (op.kind !== 'advance') {
        if (p.remaining.gte('0.01')) mine.others.push(`${ownerId},${op.id},${op.kind},${op.date.slice(0, 10)},${p.amount.toFixed()},${p.remaining.toFixed()}`);
        continue;
      }
      const amount = p.remaining.toDecimalPlaces(2, Decimal.ROUND_DOWN);
      if (amount.lte(ZERO)) continue;
      const date = op.date.slice(0, 10) > to ? op.date.slice(0, 10) : to;
      mine.forgivenesses.push({ ownerId, advance: op, date, amount, exact: p.remaining });
    }
    // a position of another kind left unrecouped (a deduction) cannot be forgiven (D-173: an advance only): the owner
    // stays on the start until the operator decides (the start works per owner, a mixed label is fine)
    if (mine.others.length > 0 && !deductionsAsDebt) {
      exempt.push(...mine.others);
      exemptOwners.add(ownerId);
      continue;
    }
    plans.push({ ownerId, missing: starts.some((r) => r.missing), atCut: withAt, now });
    adjustments.push(...mine.adjustments);
    forgivenesses.push(...mine.forgivenesses);
  }

  // ---- the simulation of the plan in memory ----
  const sim = (o: Omit<OperationView, 'meaning'>): OperationView => ({ ...o, meaning: o.kind as OperationView['meaning'] });
  const synthetic = new Map<string, OperationView[]>();
  const push = (ownerId: string, o: OperationView) => (synthetic.get(ownerId) ?? synthetic.set(ownerId, []).get(ownerId))?.push(o);
  for (const a of adjustments)
    push(a.ownerId, sim({ id: `sim-a-${a.ownerId}-${a.artistId ?? ''}-${a.area}`, kind: 'adjustment', direction: 'in', amountCents: Number(a.amount.times(100).toFixed(0)), ownerId: a.ownerId, artistId: a.artistId, date: cutDate, period: null, scope: null, documentId: SIM_DOC, paymentProofId: null, operationRef: null, deferred: false, migration: false, comment: 'sim', externalRef: null, createdAt: '', active: true, deactivatedReason: null, labelId: label.id, labelSource: 'operator', channel: null, area: a.area, allocation: null, cutId }));
  for (const x of forgivenesses)
    push(x.ownerId, sim({ ...x.advance, id: `sim-f-${x.advance.id}`, kind: 'forgiveness', direction: 'in', amountCents: Number(x.amount.times(100).toFixed(0)), date: x.date, operationRef: x.advance.id, documentId: SIM_DOC, paymentProofId: null, externalRef: null, comment: 'sim', allocation: null, cutId, scope: null, deferred: false }));
  const simCalc: Calculation = { ...w.calc, documentStatus: (id) => (id === SIM_DOC ? 'approved' : w.calc.documentStatus(id)) };
  const simCut = cutCalculationBy(simCalc, bounds);
  const diffs: string[] = ['owner_id,key,when,current,simulated,delta'];
  let worst = ZERO;
  for (const p of plans) {
    const ops = [...(w.opsOf.get(p.ownerId) ?? []), ...(synthetic.get(p.ownerId) ?? [])];
    const atCut = positionsOf(ownerBalance(simCut, p.ownerId, cutOperationsBy(ops, bounds), {}, { ...(idxCut.get(p.ownerId) ?? { units: [], publishing: [] }), starts: [] }, view), label.id);
    const now = positionsOf(ownerBalance(simCalc, p.ownerId, ops, {}, { ...(idxNow.get(p.ownerId) ?? { units: [], publishing: [] }), starts: [] }, view), label.id);
    diffs.push(...differences(p.ownerId, 'cut', p.atCut, atCut), ...differences(p.ownerId, 'now', p.now, now));
    worst = Decimal.max(worst, maxDelta(p.atCut, atCut), maxDelta(p.now, now));
  }

  const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), ZERO);
  const buckets = [1, 10, 100, 1000, Infinity].map((lim, i, arr) => {
    const lo = i === 0 ? 0 : (arr[i - 1] as number);
    return `${lo}–${lim}: ${adjustments.filter((a) => a.amount.abs().gte(lo) && a.amount.abs().lt(lim)).length}`;
  });
  console.log(`owners to migrate: ${plans.length} (with a missing row: ${plans.filter((p) => p.missing).length})`);
  console.log(`reconciling adjustments: ${adjustments.length} (publishing ${adjustments.filter((a) => a.area === 'publishing').length}), Σ ${sum(adjustments.map((a) => a.amount)).toFixed(2)}, Σ|·| ${sum(adjustments.map((a) => a.amount.abs())).toFixed(2)}; by |amount| ${buckets.join(', ')}`);
  console.log(`forgivenesses of the advances inside the start: ${forgivenesses.length}, Σ ${sum(forgivenesses.map((x) => x.amount)).toFixed(2)}`);
  console.log(`owners left on the start (a deduction unrecouped at the bound, no forgiveness for it): ${exemptOwners.size}${deductionsAsDebt ? ' (--deductions-as-debt: they migrate, the deductions stay a debt)' : ''}`);
  for (const o of exempt) console.log(`  ${o}`);
  console.log(`simulation: the largest move of a position ${worst.toFixed()}; out of the tolerance ${TOLERANCE.toFixed(2)}: ${diffs.length - 1} lines (start-to-cut-diffs.csv)`);
  if (plans.length === 0) {
    console.log('no owner to migrate: nothing to write (the csv files of the last run are kept)');
    process.exit(0);
  }
  // the plan, the forgivenesses and the differences of this run
  const outDir = join(dataDir, 'mvp-load', 'start');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'start-to-cut-adjustments.csv'), ['owner_id,artist_id,area,amount,exact', ...adjustments.map((a) => `${a.ownerId},${a.artistId ?? ''},${a.area},${a.amount.toFixed(2)},${a.exact.toFixed()}`)].join('\n') + '\n');
  writeFileSync(join(outDir, 'start-to-cut-forgivenesses.csv'), ['owner_id,advance_id,date,amount,exact', ...forgivenesses.map((x) => `${x.ownerId},${x.advance.id},${x.date},${x.amount.toFixed(2)},${x.exact.toFixed()}`)].join('\n') + '\n');
  writeFileSync(join(outDir, 'start-to-cut-diffs.csv'), diffs.join('\n') + '\n');
  if (diffs.length > 1) {
    process.exitCode = 2;
    throw new Error('the simulation moves positions: nothing written');
  }
  if (!apply) {
    console.log('dry run: nothing written (--apply writes it)');
    process.exit(0);
  }
  if (!cut) throw new Error('unreachable');

  // ---- the apply: one transaction, verified inside it ----
  const moving = w.rows.filter((r) => !exemptOwners.has(w.calc.artistIndex.get(r.artistId)?.ownerId ?? ''));
  const t1 = performance.now();
  const result = await stack.db.transaction(async () => {
    const doc = await f.createDocument({ kind: 'adjustment_basis', title: `Старт ${cutDate} → срез «${cut.name}»`, fileRef: `start-to-cut://${label.id}/${cutDate}`, requiresApproval: false, labelId: label.id });
    await f.approveDocument(doc.id, OPERATOR);
    for (const a of adjustments)
      await f.createOperation({
        kind: 'adjustment',
        direction: 'in',
        amount: a.amount.toFixed(2),
        ownerId: a.ownerId,
        artistId: a.artistId,
        date: cutDate,
        documentId: doc.id,
        comment: `Сверка с кабинетом на ${cutDate} (старт D-174 → срез, D-203)`,
        labelId: label.id,
        area: a.area,
        externalRef: `${REF}${a.ownerId}:${a.artistId ?? ''}:${a.area}`,
        cutId: cut.id,
      });
    for (const x of forgivenesses)
      await settlements.createOperation({
        kind: 'forgiveness',
        direction: 'in',
        amountCents: Number(x.amount.times(100).toFixed(0)),
        date: x.date,
        operationRef: x.advance.id,
        documentId: doc.id,
        comment: `Остаток аванса на ${cutDate} учтён в кабинете (старт D-174 → срез, D-203)`,
        externalRef: `${REF}forgive:${x.advance.id}`,
        cutId: cut.id,
      });
    for (const p of plans.filter((q) => q.missing))
      await f.createHold({ ownerId: p.ownerId, labelId: label.id, kind: 'question', blocks: true, reason: `В кабинете на ${cutDate} не было суммы (старт missing, D-174 → D-203)`, source: OPERATOR });
    for (const r of moving) await settlements.deactivateOpeningBalance(r.id, `the start became the cut «${cut.name}» (D-203)`);

    // the comparison on the written data, inside the transaction
    const after = await readWorld();
    if (after.rows.length !== w.rows.length - moving.length) throw new Error('unexpected start rows still active');
    const b = boundsOf(after.cuts);
    const aCut = cutCalculationBy(after.calc, b);
    const aIdxCut = ownerIndex(aCut);
    const aIdxNow = ownerIndex(after.calc);
    const bad: string[] = [];
    let worstAfter = ZERO;
    for (const p of plans) {
      const ops = after.opsOf.get(p.ownerId) ?? [];
      const atCut = positionsOf(ownerBalance(aCut, p.ownerId, cutOperationsBy(ops, b), {}, { ...(aIdxCut.get(p.ownerId) ?? { units: [], publishing: [] }), starts: [] }, view), label.id);
      const now = positionsOf(ownerBalance(after.calc, p.ownerId, ops, {}, { ...(aIdxNow.get(p.ownerId) ?? { units: [], publishing: [] }), starts: [] }, view), label.id);
      bad.push(...differences(p.ownerId, 'cut', p.atCut, atCut), ...differences(p.ownerId, 'now', p.now, now));
      worstAfter = Decimal.max(worstAfter, maxDelta(p.atCut, atCut), maxDelta(p.now, now));
    }
    if (bad.length > 0) {
      for (const l of bad.slice(0, 20)) console.log(`  ${l}`);
      throw new Error(`${bad.length} positions moved after the write: rolled back`);
    }
    return { doc: doc.id, worstAfter };
  });
  console.log(`applied in ${((performance.now() - t1) / 1000).toFixed(1)} s: document ${result.doc}, ${adjustments.length} adjustments, ${forgivenesses.length} forgivenesses, ${plans.filter((p) => p.missing).length} holds, ${moving.length} start rows deactivated (${w.rows.length - moving.length} stay); the largest move after the write ${result.worstAfter.toFixed()}`);
} finally {
  await stack.close();
}
