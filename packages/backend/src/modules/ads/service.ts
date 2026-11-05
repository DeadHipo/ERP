import { NotFoundError, ValidationError } from '../../shared/errors';
import { assertIsrc, newId } from '../../shared/identifiers';
import { assertMonth, monthStart, nowIso } from '../../shared/dates';
import { Decimal, decimalToCents, parseUsd } from '../../shared/money';
import type { Db } from '../../shared/pg-db';
import { createAdsRepository, type ExpenseFilter, type ExpenseRow } from './repository';

/** Where the recovered part of an expense is recouped from: the whole balance, publishing, or this ISRC (D-155). */
export type AdScope = 'any' | 'publishing' | 'isrc';
export const AD_SCOPES: readonly AdScope[] = ['any', 'publishing', 'isrc'];

export interface AdExpense {
  id: string;
  isrc: string | null;
  /** YYYY-MM */
  month: string;
  amountCents: number;
  /** 0..100, canonical decimal text. */
  recoveryPercent: string;
  scope: AdScope;
  artistId: string | null;
  externalRef: string | null;
  source: string;
  migration: boolean;
  comment: string;
  createdAt: string;
  active: boolean;
  deactivatedReason: string | null;
  /** The own label of a record without an ISRC (D-168); with an ISRC the line of the ISRC decides, this is the fallback. */
  labelId: string | null;
}

export interface AdExpenseInput {
  isrc?: string | null;
  month: string;
  /** USD decimal string, > 0, whole cents. */
  amount: string;
  recoveryPercent?: string;
  scope?: AdScope;
  artistId?: string | null;
  externalRef?: string | null;
  source?: string;
  migration?: boolean;
  comment?: string;
  labelId?: string | null;
}

export interface AdExpenseFilter {
  isrc?: string;
  artistIds?: string[];
  /** YYYY-MM, inclusive. */
  from?: string;
  to?: string;
  active?: boolean;
}

const HUNDRED = new Decimal(100);

/** Recovery percent: 0..100 with at most 2 decimals, canonical text. */
export function parseRecoveryPercent(raw: string): string {
  const t = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) throw new ValidationError(`Invalid recovery percent "${raw}" (0..100, up to 2 decimals)`);
  const d = new Decimal(t);
  if (d.gt(HUNDRED)) throw new ValidationError(`Recovery percent ${raw} is above 100`);
  return d.toFixed();
}

function parseScope(raw: string | undefined): AdScope {
  const s = (raw ?? 'any') as AdScope;
  if (!AD_SCOPES.includes(s)) throw new ValidationError(`Unknown scope "${raw}" (any, publishing, isrc)`);
  return s;
}

const view = (r: ExpenseRow): AdExpense => ({
  id: r.id,
  isrc: r.isrc,
  month: r.month.slice(0, 7),
  amountCents: r.amountCents,
  recoveryPercent: new Decimal(r.recoveryPercent).toFixed(),
  scope: r.scope,
  artistId: r.artistId,
  externalRef: r.externalRef,
  source: r.source,
  migration: r.migration,
  comment: r.comment,
  createdAt: r.createdAt,
  active: r.deactivatedAt === null,
  deactivatedReason: r.deactivatedReason,
  labelId: r.labelId,
});

const toRepoFilter = (f: AdExpenseFilter): ExpenseFilter => ({
  isrc: f.isrc ? assertIsrc(f.isrc) : undefined,
  artistIds: f.artistIds,
  from: f.from ? monthStart(assertMonth(f.from)) : undefined,
  to: f.to ? monthStart(assertMonth(f.to)) : undefined,
  active: f.active,
});

/**
 * The ads module records advertising expenses and checks their shape. It computes no money: who bears an expense
 * and what it recoups is decided in the facade (facade/ads.ts), recalculated from scratch.
 */
export function createAdsService(db: Db) {
  const repo = createAdsRepository(db);

  function validate(input: AdExpenseInput, createdAt: string) {
    const isrc = input.isrc ? assertIsrc(input.isrc) : null;
    const artistId = input.artistId?.trim() || null;
    if (!isrc && !artistId) throw new ValidationError('An expense needs an ISRC (or, for an allocated one, a pseudonym)');
    const month = assertMonth(input.month);
    const amount = parseUsd(input.amount);
    if (!amount.gt(0)) throw new ValidationError(`Amount ${input.amount} must be above 0`);
    const scope = parseScope(input.scope);
    if (scope === 'isrc' && !isrc) throw new ValidationError('Scope "isrc" needs an ISRC');
    const labelId = input.labelId?.trim() || null;
    // a record without an ISRC has no line to take the label from (D-168)
    if (!isrc && !labelId) throw new ValidationError('An expense without an ISRC needs the label it belongs to', undefined, 'label_required');
    return {
      id: newId(),
      isrc,
      month: monthStart(month),
      amountCents: decimalToCents(amount),
      recoveryPercent: parseRecoveryPercent(input.recoveryPercent ?? '100'),
      scope,
      artistId,
      externalRef: input.externalRef?.trim() || null,
      source: input.source?.trim() || 'manual',
      migration: input.migration ?? false,
      comment: input.comment?.trim() ?? '',
      createdAt,
      deactivatedAt: null,
      deactivatedReason: null,
      labelId,
    };
  }

  return {
    /**
     * Records a batch: every arrival of data is a new record. A record whose external ref is already known (or repeats
     * inside the batch) is skipped, so a repeated upload changes nothing. All or nothing.
     */
    async createMany(inputs: AdExpenseInput[]): Promise<{ created: AdExpense[]; skipped: string[] }> {
      if (inputs.length === 0) throw new ValidationError('No expenses given');
      const now = nowIso();
      const rows = inputs.map((i, n) => {
        try {
          return validate(i, now);
        } catch (e) {
          if (e instanceof ValidationError) throw new ValidationError(`Item ${n + 1}: ${e.message}`, e.details, e.code);
          throw e;
        }
      });
      return repo.transaction(async () => {
        const known = await repo.existingRefs(rows.map((r) => r.externalRef).filter((x): x is string => !!x));
        const seen = new Set<string>();
        const fresh: typeof rows = [];
        const skipped: string[] = [];
        for (const r of rows) {
          if (r.externalRef && (known.has(r.externalRef) || seen.has(r.externalRef))) {
            skipped.push(r.externalRef);
            continue;
          }
          if (r.externalRef) seen.add(r.externalRef);
          fresh.push(r);
        }
        for (let i = 0; i < fresh.length; i += 2000) await repo.insert(fresh.slice(i, i + 2000));
        return { created: fresh.map(view), skipped };
      });
    },
    async get(id: string): Promise<AdExpense> {
      const r = await repo.get(id);
      if (!r) throw new NotFoundError('Ad expense', id);
      return view(r);
    },
    async list(f: AdExpenseFilter = {}): Promise<AdExpense[]> {
      return (await repo.list(toRepoFilter(f))).map(view);
    },
    async all(): Promise<AdExpense[]> {
      return (await repo.all()).map(view);
    },
    /** The two fields that may change at any time (D-155): the recovery percent and the scope. */
    async update(id: string, patch: { recoveryPercent?: string; scope?: AdScope }): Promise<AdExpense> {
      return repo.transaction(async () => {
        const cur = await this.get(id);
        if (!cur.active) throw new ValidationError(`Ad expense ${id} is deactivated`);
        if (patch.recoveryPercent === undefined && patch.scope === undefined)
          throw new ValidationError('Nothing to change (recoveryPercent or scope)');
        const scope = patch.scope === undefined ? cur.scope : parseScope(patch.scope);
        if (scope === 'isrc' && !cur.isrc) throw new ValidationError('Scope "isrc" needs an ISRC');
        await repo.update(id, {
          scope,
          recoveryPercent:
            patch.recoveryPercent === undefined ? cur.recoveryPercent : parseRecoveryPercent(patch.recoveryPercent),
        });
        return this.get(id);
      });
    },
    async deactivate(id: string, reason: string): Promise<AdExpense> {
      return repo.transaction(async () => {
        const cur = await this.get(id);
        if (!cur.active) throw new ValidationError(`Ad expense ${id} is already deactivated`);
        if (!reason.trim()) throw new ValidationError('A deactivation needs a reason');
        await repo.update(id, { deactivatedAt: nowIso(), deactivatedReason: reason.trim() });
        return this.get(id);
      });
    },
  };
}

export type AdsService = ReturnType<typeof createAdsService>;
