import { centsToDecimal, Decimal, ZERO } from '../shared/money';
import { ValidationError } from '../shared/errors';
import type { CReason } from '@erp/shared/api-responses';
import { calculate, reconcile } from './calculation';
import { classifyOperation, ownerBalance, ownerIndex } from './balance';
import { cutCalculation, cutFilter, cutOperations } from './as-of';
import type { FacadeContext, PayoutArea } from './context';
import { ALL_VIEWER, assertViewerHolds, type Viewer } from './viewer';
import { admissionIndex, admissionOf, contractThresholds } from './admission';

// The payroll of one label (D-173 §1.4, `GET /owners/payroll`): ONE full calculation, the cut `asOf` on the inputs of
// `ownerBalance()` (`as-of.ts`), the view `{ labelId }`; a row per owner × pseudonym, the owner row, the total row with
// the gate of the area, and the sheets «waiting», «buyouts», «control». Nothing here decides money: every number is a
// field of the balance of the book (or of the reconciliation); the rows of an owner add up to its total row.

export type PayrollSheet = 'payroll' | 'waiting' | 'buyouts' | 'control';

const MONEY = ['earned', 'recouped', 'unrecouped', 'adsCharged', 'paid', 'returns', 'credits', 'buyouts', 'forgiven', 'writtenOff', 'adjustments'] as const;
type MoneyKey = (typeof MONEY)[number];
type Money = Record<MoneyKey, Decimal>;
const zeroMoney = (): Money => Object.fromEntries(MONEY.map((k) => [k, ZERO])) as Money;

interface Contract {
  number: string | null;
  documentId: string;
  title: string;
  documentKind: string;
  labelId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface PayrollRow extends Money {
  rowKind: 'pseudonym' | 'owner' | 'total';
  labelName: string;
  ownerId: string;
  ownerName: string;
  artistId: string | null;
  pseudonym: string | null;
  contract: Contract | null;
  byDecision: boolean;
  /** A pseudonym row: its position (D-181); the owner row: the owner's own position; the total row: the formula of the area. */
  payable: Decimal | null;
  /** A pseudonym or owner row: max(0, position); the total row: Σ of them = what the owner is paid (D-181). */
  payableShown: Decimal | null;
  gate: { allowed: boolean; reason: string | null; amountCents: number | null; blockedByOtherLabel: boolean } | null;
  belowThreshold: boolean;
}

export interface Payroll {
  calculatedAt: string;
  label: { id: string; name: string };
  asOf: string | null;
  area: PayoutArea;
  rows: PayrollRow[];
  waiting: { ownerId: string; ownerName: string; reason: CReason; amount: Decimal; paidAlready: Decimal }[];
  buyouts: { operationId: string; ownerId: string; ownerName: string; date: string; amount: Decimal; documentId: string | null; counted: boolean }[];
  control: { source: 'believe' | 'b17'; account: string; month: string; A: Decimal; B: Decimal; C: Decimal; ours: Decimal; discrepancy: Decimal }[];
  totals: {
    payable: Decimal;
    payableShown: Decimal;
    bookB: Decimal;
    reconciliationB: Decimal;
    bookBMatches: boolean;
    relabelledOperations: number;
    defaultLabelOperations: number;
  };
}

type Cell = string | number | boolean | null | Decimal;
const cellText = (v: Cell): string => (v === null ? '' : v instanceof Decimal ? (v.isZero() ? '0' : v.toFixed()) : String(v));

/** A csv text: UTF-8 BOM, `;`, every field quoted (`"` doubled), CRLF lines, the decimal point of JSON money. */
export function csvText(header: readonly string[], rows: readonly Cell[][]): string {
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return '﻿' + [header, ...rows].map((r) => r.map((c) => quote(cellText(c))).join(';')).join('\r\n') + '\r\n';
}

/** The columns of a sheet and its rows as cells (the csv and the test read the same table). */
export function payrollSheet(p: Payroll, sheet: PayrollSheet): { header: string[]; rows: Cell[][] } {
  switch (sheet) {
    case 'payroll':
      return {
        header: [
          'rowKind', 'labelName', 'ownerId', 'ownerName', 'artistId', 'pseudonym',
          'contractNumber', 'contractDocumentId', 'contractTitle', 'contractKind', 'contractLabelId', 'contractApprovedAt', 'contractApprovedBy',
          'byDecision', ...MONEY, 'payable', 'payableShown',
          'gateAllowed', 'gateReason', 'gateAmountCents', 'blockedByOtherLabel', 'belowThreshold',
        ],
        rows: p.rows.map((r) => [
          r.rowKind, r.labelName, r.ownerId, r.ownerName, r.artistId, r.pseudonym,
          r.contract?.number ?? null, r.contract?.documentId ?? null, r.contract?.title ?? null, r.contract?.documentKind ?? null,
          r.contract?.labelId ?? null, r.contract?.approvedAt ?? null, r.contract?.approvedBy ?? null,
          r.byDecision, ...MONEY.map((k) => r[k]), r.payable, r.payableShown,
          r.gate?.allowed ?? null, r.gate?.reason ?? null, r.gate?.amountCents ?? null, r.gate?.blockedByOtherLabel ?? null, r.belowThreshold,
        ]),
      };
    case 'waiting':
      return {
        header: ['ownerId', 'ownerName', 'reason', 'amount', 'paidAlready'],
        rows: p.waiting.map((w) => [w.ownerId, w.ownerName, w.reason, w.amount, w.paidAlready]),
      };
    case 'buyouts':
      return {
        header: ['operationId', 'ownerId', 'ownerName', 'date', 'amount', 'documentId', 'counted'],
        rows: p.buyouts.map((b) => [b.operationId, b.ownerId, b.ownerName, b.date, b.amount, b.documentId, b.counted]),
      };
    case 'control':
      return {
        header: ['source', 'account', 'month', 'A', 'B', 'C', 'ours', 'discrepancy'],
        rows: p.control.map((c) => [c.source, c.account, c.month, c.A, c.B, c.C, c.ours, c.discrepancy]),
      };
  }
}

/** The file name of a csv sheet: `payroll_<label>_<asOf|all>_<area>_<sheet>.csv`. */
export const payrollFileName = (p: Payroll, sheet: PayrollSheet) => `payroll_${p.label.name}_${p.asOf ?? 'all'}_${p.area}_${sheet}.csv`;

const sum = (xs: Decimal[]) => xs.reduce((s, x) => s.add(x), ZERO);

export function payrollApi(ctx: FacadeContext) {
  const { db, owners, settlements, audit, modules, opDocIds, gateOf, labelContext, assertOwnLabel } = ctx;

  const api = {
    /**
     * The payroll of the book of one own label (D-173 §1.4); `area` master by default (the button), `asOf` the cut.
     * A viewer of some labels (D-171): one of its labels, else 403 `label_forbidden`.
     */
    async payroll(labelId: string | undefined, opts: { asOf?: string; area?: PayoutArea } = {}, viewer: Viewer = ALL_VIEWER): Promise<Payroll> {
      if (!labelId) throw new ValidationError('The payroll is the book of one label (label=)', undefined, 'label_required');
      const label = await assertOwnLabel(labelId);
      if (viewer.kind !== 'all') assertViewerHolds(viewer, labelId);
      const area = opts.area ?? 'master';
      const asOf = opts.asOf;
      const lc = await labelContext(labelId);
      const visible = lc?.visible.ownerIds ?? new Set<string>();
      const { list, ops, contracts, relabelled, admission } = await db.snapshot(async () => {
        const contracts = await owners.approvedContracts();
        return {
          list: (await owners.listOwners()).filter((o) => visible.has(o.id)),
          ops: await settlements.listOperations({}),
          contracts,
          relabelled: await audit.relabelledOperations(),
          // the admission (D-176): the payee, holds and answers of every owner, the contract thresholds under the label
          admission: await admissionIndex(settlements, contractThresholds(contracts, labelId)),
        };
      });
      const full = await calculate(modules, await opDocIds());
      const calc = cutCalculation(full, asOf);
      const cut = cutOperations(ops, asOf);
      const f = cutFilter({}, asOf);
      const index = ownerIndex(calc);
      const opsOf = new Map<string, typeof ops>();
      for (const o of cut) if (o.ownerId) (opsOf.get(o.ownerId) ?? opsOf.set(o.ownerId, []).get(o.ownerId))?.push(o);
      const opById = new Map(ops.map((o) => [o.id, o]));
      const view = { labelId };

      // the contract under the label: its own label before «any label», then the newest approval
      const contractOf = new Map<string, Contract>();
      const rank = (c: Contract) => (c.labelId === labelId ? 0 : 1);
      for (const c of contracts) {
        if (c.labelId !== null && c.labelId !== labelId) continue;
        const { ownerId, ...rest } = c;
        const prev = contractOf.get(ownerId);
        const newer =
          !prev ||
          rank(rest) < rank(prev) ||
          (rank(rest) === rank(prev) && ((rest.approvedAt ?? '') > (prev.approvedAt ?? '') || ((rest.approvedAt ?? '') === (prev.approvedAt ?? '') && rest.documentId < prev.documentId)));
        if (newer) contractOf.set(ownerId, rest);
      }

      const rows: PayrollRow[] = [];
      const waiting: Payroll['waiting'] = [];
      const owners_ = [...list].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const nameOf = new Map(list.map((o) => [o.id, o.name]));
      for (const o of owners_) {
        const b = ownerBalance(calc, o.id, opsOf.get(o.id) ?? [], f, index.get(o.id) ?? { units: [], publishing: [] }, view);
        const t = b.total;
        const pick = (k: Exclude<MoneyKey, 'unrecouped' | 'forgiven'>) => (area === 'all' ? t[k] : t.byArea[area][k]);
        const contract = contractOf.get(o.id) ?? null;
        const base = {
          labelName: label.name,
          ownerId: o.id,
          ownerName: o.name,
          contract,
          byDecision: contract?.documentKind === 'label_decision',
        };
        // the total of the area
        const total: Money = {
          earned: pick('earned'),
          recouped: pick('recouped'),
          unrecouped: area === 'publishing' ? ZERO : sum(b.positions.map((p) => p.remaining)),
          adsCharged: pick('adsCharged'),
          paid: pick('paid'),
          returns: pick('returns'),
          credits: pick('credits'),
          buyouts: pick('buyouts'),
          forgiven: area === 'publishing' ? ZERO : t.forgiven,
          writtenOff: pick('writtenOff'),
          adjustments: pick('adjustments'),
        };
        const payable = area === 'all' ? t.payable : t.byArea[area].payable;
        // D-181: what the owner is paid = Σ of the positive positions of its pseudonyms (and its own)
        const payableShown = area === 'all' ? t.payableShown : t.byArea[area].payableShown;
        const ownerPosition = area === 'all' ? t.ownerPosition : t.byArea[area].ownerPosition;
        // the pseudonym rows (master): its earned, recoupedFromMaster (by the artist of the income, FIX-10), the
        // unrecouped and forgiven of the positions it holds, its advertising
        const pseudonymRows: PayrollRow[] = [];
        if (area !== 'publishing')
          for (const a of b.artists) {
            const m = zeroMoney();
            m.earned = a.earned;
            m.recouped = a.recoupedFromMaster;
            m.unrecouped = a.unrecouped;
            m.forgiven = a.forgiven;
            m.adsCharged = sum(b.ads.filter((x) => x.artistId === a.artistId).map((x) => x.amount));
            // the position of the pseudonym in the area (D-181): its `payable`; what it adds to the owner's payout = max(0, position)
            const position = area === 'all' ? a.position : sum(Object.values(a.byLabel).map((x) => x.positionByArea[area]));
            if (MONEY.every((k) => m[k].isZero()) && position.isZero()) continue;
            pseudonymRows.push({ rowKind: 'pseudonym', ...base, artistId: a.artistId, pseudonym: a.pseudonym, ...m, payable: position, payableShown: Decimal.max(position, 0), gate: null, belowThreshold: false });
          }
        // the owner row: the rest of the total (publishing earned and publishingRecouped, the operations), so that the
        // rows of the owner add up to its total exactly
        const ownerMoney = zeroMoney();
        for (const k of MONEY) ownerMoney[k] = total[k].sub(sum(pseudonymRows.map((r) => r[k])));
        // the waiting money of the owner in the book (the sheet «waiting»), with what the book already paid it
        for (const [reason, amount] of Object.entries(b.period.waitingBreakdown) as [CReason, Decimal][])
          if (!amount.isZero()) waiting.push({ ownerId: o.id, ownerName: o.name, reason, amount, paidAlready: t.paid });
        if (MONEY.every((k) => total[k].isZero()) && payable.isZero()) continue;
        const gate = gateOf(b, area, admissionOf(admission.byOwner.get(o.id), { active: admission.active, thresholdCents: admission.thresholdOf(o.id), labelId, operations: ops.filter((x) => x.ownerId === o.id) }));
        const blockedByOtherLabel =
          gate.reason === 'payout_blocked' && b.blockingPayouts.every((id) => opById.get(id)?.labelId !== labelId);
        rows.push(...pseudonymRows);
        rows.push({ rowKind: 'owner', ...base, artistId: null, pseudonym: null, ...ownerMoney, payable: ownerPosition, payableShown: Decimal.max(ownerPosition, 0), gate: null, belowThreshold: false });
        rows.push({
          rowKind: 'total',
          ...base,
          artistId: null,
          pseudonym: null,
          ...total,
          payable,
          payableShown,
          gate: { allowed: gate.allowed, reason: gate.reason, amountCents: blockedByOtherLabel ? null : gate.amountCents, blockedByOtherLabel },
          belowThreshold: gate.reason === 'below_threshold',
        });
      }

      const buyouts: Payroll['buyouts'] = cut
        .filter((o) => o.kind === 'buyout' && o.active && o.labelId === labelId && o.ownerId)
        .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        .map((o) => ({
          operationId: o.id,
          ownerId: o.ownerId as string,
          ownerName: nameOf.get(o.ownerId as string) ?? '?',
          date: o.date,
          amount: centsToDecimal(o.amountCents),
          documentId: o.documentId,
          counted: classifyOperation(o, calc.documentStatus).counted,
        }));

      // A = B + C + ours of the book of the label, by account and month, inside the cut (believe = master, b17 = publishing)
      const sources = area === 'master' ? ['believe'] : area === 'publishing' ? ['b17'] : ['believe', 'b17'];
      const control: Payroll['control'] = reconcile(full, asOf === undefined ? {} : { to: asOf })
        .filter((r) => sources.includes(r.source) && r.byLabel[label.name])
        .map((r) => {
          const x = r.byLabel[label.name] as NonNullable<(typeof r.byLabel)[string]>;
          return {
            source: r.source,
            account: r.account,
            month: r.month,
            A: x.A_received,
            B: x.B_notOurs,
            C: x.C_waiting,
            ours: x.ourShare,
            discrepancy: x.A_received.sub(x.B_notOurs).sub(x.C_waiting).sub(x.ourShare),
          };
        });

      const totalRows = rows.filter((r) => r.rowKind === 'total');
      const bookB = sum(totalRows.map((r) => r.earned));
      const reconciliationB = sum(control.map((c) => c.B));
      return {
        calculatedAt: new Date().toISOString(),
        label: { id: label.id, name: label.name },
        asOf: asOf ?? null,
        area,
        rows,
        waiting,
        buyouts,
        control,
        totals: {
          payable: sum(totalRows.map((r) => r.payable as Decimal)),
          payableShown: sum(totalRows.map((r) => r.payableShown as Decimal)),
          bookB,
          reconciliationB,
          bookBMatches: bookB.eq(reconciliationB),
          // the same rule as the signal operationsRelabelled under a label (D-173 §1.2)
          relabelledOperations: relabelled.filter((r) => opById.get(r.operationId)?.labelId === labelId || r.fromLabelIds.includes(labelId)).length,
          defaultLabelOperations: ops.filter((o) => o.active && o.labelId === labelId && o.labelSource === 'default').length,
        },
      };
    },

    /** One sheet of the payroll as a csv file (`csvText`): the same rows as the json. */
    async payrollCsv(labelId: string | undefined, opts: { asOf?: string; area?: PayoutArea; sheet?: PayrollSheet } = {}, viewer: Viewer = ALL_VIEWER) {
      const p = await api.payroll(labelId, opts, viewer);
      const sheet = opts.sheet ?? 'payroll';
      const { header, rows } = payrollSheet(p, sheet);
      return { fileName: payrollFileName(p, sheet), text: csvText(header, rows) };
    },
  };
  return api;
}
