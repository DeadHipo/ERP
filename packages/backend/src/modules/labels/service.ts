import { Decimal } from '../../shared/money';
import { ConflictError, NotFoundError, RuleViolationError, ValidationError } from '../../shared/errors';
import { newId } from '../../shared/identifiers';
import { assertDate, nowIso, type IsoDate } from '../../shared/dates';
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import type { AccountRow, AliasRow, LabelRow, RuleRow } from './repository';
import { createLabelsRepository } from './repository';

export type LabelKind = 'own' | 'sublabel';

export interface RuleView {
  id: string;
  labelId: string;
  percent: string;
  recipientArtistId: string;
  validFrom: IsoDate;
  validTo: IsoDate | null;
  documentId: string | null;
  note: string | null;
}

export interface LabelView {
  id: string;
  name: string;
  kind: LabelKind;
  ownLabelId: string | null;
  aliases: string[];
  rules: RuleView[];
  /** The Believe accounts of an own label (D-168); empty for a sublabel. */
  accounts: string[];
}

export interface LabelOfRecord {
  id: string;
  name: string;
  kind: LabelKind;
  ownLabelId: string | null;
  rule: { id: string; percent: Decimal; recipientArtistId: string; documentId: string | null } | null;
}

/** Alias normalisation: NFKC, lower case, white space collapsed and trimmed. */
export const normalizeLabelString = (raw: string): string =>
  raw.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

const HUNDRED = new Decimal(100);

/** Percent: 0..100 with at most 6 decimals (same shape as a split share). */
function parsePercent(raw: string): Decimal {
  if (!/^\d+(\.\d{1,6})?$/.test(String(raw).trim()))
    throw new ValidationError(`Invalid percent "${raw}" (0..100, up to 6 decimals)`);
  const d = new Decimal(String(raw).trim());
  if (d.gt(HUNDRED)) throw new ValidationError(`Percent ${raw} is above 100`);
  return d;
}

const covers = (r: Pick<RuleRow, 'validFrom' | 'validTo'>, date: IsoDate) =>
  r.validFrom <= date && (r.validTo === null || date < r.validTo);

const overlaps = (
  a: { validFrom: string; validTo: string | null },
  b: { validFrom: string; validTo: string | null },
) => a.validFrom < (b.validTo ?? '9999-12-31') && b.validFrom < (a.validTo ?? '9999-12-31');

const ruleView = (r: RuleRow): RuleView => ({
  id: r.id,
  labelId: r.labelId,
  percent: r.percent,
  recipientArtistId: r.recipientArtistId,
  validFrom: r.validFrom,
  validTo: r.validTo,
  documentId: r.documentId,
  note: r.note,
});

export function createLabelsService(db: Db, org: OrgScope) {
  const repo = createLabelsRepository(db, org);

  const view = (l: LabelRow, aliases: AliasRow[], rules: RuleRow[], accounts: AccountRow[]): LabelView => ({
    id: l.id,
    name: l.name,
    kind: l.kind,
    ownLabelId: l.ownLabelId,
    aliases: aliases.filter((a) => a.labelId === l.id).map((a) => a.alias),
    rules: rules.filter((r) => r.labelId === l.id).map(ruleView),
    accounts: accounts.filter((a) => a.labelId === l.id).map((a) => a.account),
  });

  const service = {
    /** An own label stands alone; a sublabel belongs to an existing own label. */
    async createLabel(input: {
      name: string;
      kind: LabelKind;
      ownLabelId?: string | null;
    }): Promise<LabelView> {
      const name = input.name.trim();
      if (!name) throw new ValidationError('Label name is empty');
      if (input.kind !== 'own' && input.kind !== 'sublabel')
        throw new ValidationError(`Unknown label kind "${String(input.kind)}"`);
      return repo.transaction(async () => {
        let ownLabelId: string | null = null;
        if (input.kind === 'sublabel') {
          if (!input.ownLabelId)
            throw new ValidationError('A sublabel needs the own label its money belongs to');
          const own = await repo.getLabel(input.ownLabelId);
          if (!own) throw new NotFoundError('Label', input.ownLabelId);
          if (own.kind !== 'own') throw new ValidationError('ownLabelId must be a label of kind own');
          ownLabelId = own.id;
        } else if (input.ownLabelId) {
          throw new ValidationError('An own label has no own label id');
        }
        // one name per organization (labels_org_name, D-170); writes are serialized, so the check holds at insert
        if (await repo.labelByName(name))
          throw new ConflictError(`A label named "${name}" already exists`, 'label_name_taken');
        const id = newId();
        await repo.insertLabel({ id, name, kind: input.kind, ownLabelId, createdAt: nowIso() });
        return service.getLabel(id);
      });
    },

    /** Registers an imprint string as an alias of a label; a string belongs to one label only. */
    async addAlias(labelId: string, alias: string): Promise<LabelView> {
      const norm = normalizeLabelString(alias);
      if (!norm) throw new ValidationError('Alias is empty');
      return repo.transaction(async () => {
        if (!(await repo.getLabel(labelId))) throw new NotFoundError('Label', labelId);
        if (await repo.getAlias(norm))
          throw new ConflictError(`Alias "${alias.trim()}" is already taken`, 'alias_taken');
        await repo.insertAlias({ aliasNorm: norm, alias: alias.trim(), labelId });
        return service.getLabel(labelId);
      });
    },

    /** The sublabel rule: `percent` of the label share goes to the recipient pseudonym for a period. */
    async setRule(input: {
      labelId: string;
      percent: string;
      recipientArtistId: string;
      validFrom: string;
      validTo?: string | null;
      documentId?: string | null;
      note?: string | null;
    }): Promise<RuleView> {
      const percent = parsePercent(input.percent);
      const validFrom = assertDate(input.validFrom);
      const validTo = input.validTo ? assertDate(input.validTo) : null;
      if (validTo !== null && validTo <= validFrom)
        throw new ValidationError('valid_to must be after valid_from');
      if (!input.recipientArtistId) throw new ValidationError('A rule needs a recipient pseudonym');
      return repo.transaction(async () => {
        const label = await repo.getLabel(input.labelId);
        if (!label) throw new NotFoundError('Label', input.labelId);
        if (label.kind !== 'sublabel')
          throw new RuleViolationError('A rule is set only for a sublabel', 'rule_for_own_label');
        for (const other of await repo.rulesOfLabel(label.id)) {
          if (overlaps(other, { validFrom, validTo }))
            throw new ConflictError(
              `Rule period overlaps an existing rule of ${label.name} from ${other.validFrom}`,
              'rule_overlap',
            );
        }
        const id = newId();
        await repo.insertRule({
          id,
          labelId: label.id,
          percent: percent.toFixed(),
          recipientArtistId: input.recipientArtistId,
          validFrom,
          validTo,
          documentId: input.documentId ?? null,
          note: input.note ?? null,
          createdAt: nowIso(),
        });
        return service.getRule(id);
      });
    },

    /** Ends a rule at a date (exclusive). The history stays. */
    async closeRule(id: string, validToRaw: string): Promise<RuleView> {
      const validTo = assertDate(validToRaw);
      return repo.transaction(async () => {
        const r = await repo.getRule(id);
        if (!r) throw new NotFoundError('Label rule', id);
        if (validTo <= r.validFrom) throw new ValidationError('valid_to must be after valid_from');
        if (r.validTo !== null && validTo > r.validTo)
          throw new ValidationError('A rule can only be closed earlier, not extended');
        await repo.setRuleValidTo(id, validTo);
        return service.getRule(id);
      });
    },

    async getRule(id: string): Promise<RuleView> {
      const r = await repo.getRule(id);
      if (!r) throw new NotFoundError('Label rule', id);
      return ruleView(r);
    },

    async getLabel(id: string): Promise<LabelView> {
      const l = await repo.getLabel(id);
      if (!l) throw new NotFoundError('Label', id);
      const [aliases, rules, accounts] = await db.snapshot(() =>
        Promise.all([repo.allAliases(), repo.rulesOfLabel(id), repo.allAccounts()]),
      );
      return view(l, aliases, rules, accounts);
    },

    /** A Believe account of an own label (D-168): an account belongs to one label. */
    async addAccount(labelId: string, accountRaw: string): Promise<LabelView> {
      const account = accountRaw.trim();
      if (!account) throw new ValidationError('Account is empty');
      return repo.transaction(async () => {
        const l = await repo.getLabel(labelId);
        if (!l) throw new NotFoundError('Label', labelId);
        if (l.kind !== 'own') throw new RuleViolationError('A Believe account belongs to an own label', 'account_for_sublabel');
        const taken = await repo.getAccount(account);
        if (taken) throw new ConflictError(`Account ${account} already belongs to a label`, 'account_taken');
        await repo.insertAccount({ account, labelId: l.id, createdAt: nowIso() });
        return service.getLabel(l.id);
      });
    },

    /** Removes a Believe account from its own label (D-169); 404 when it is not registered under that label. */
    async removeAccount(labelId: string, accountRaw: string): Promise<LabelView> {
      const account = accountRaw.trim();
      return repo.transaction(async () => {
        if (!(await repo.getLabel(labelId))) throw new NotFoundError('Label', labelId);
        const row = await repo.getAccount(account);
        if (!row || row.labelId !== labelId) throw new NotFoundError(`Believe account of label ${labelId}`, account);
        await repo.deleteAccount(account);
        return service.getLabel(labelId);
      });
    },

    /** Every registered Believe account with its own label (D-168). */
    async listAccounts(): Promise<{ account: string; labelId: string }[]> {
      return (await repo.allAccounts()).map((a) => ({ account: a.account, labelId: a.labelId }));
    },

    async search(
      q: string,
      limit: number,
    ): Promise<{ id: string; name: string; kind: 'own' | 'sublabel' }[]> {
      const needle = q.trim();
      if (!needle) return [];
      return (await repo.searchLabels(needle, limit)).map((l) => ({ id: l.id, name: l.name, kind: l.kind }));
    },

    async listLabels(): Promise<LabelView[]> {
      const [rows, aliases, rules, accounts] = await db.snapshot(() =>
        Promise.all([repo.allLabels(), repo.allAliases(), repo.allRules(), repo.allAccounts()]),
      );
      return rows.map((l) => view(l, aliases, rules, accounts));
    },

    /** In-memory index, built once per facade calculation (one consistent read of the module). */
    async index() {
      const [rows, aliases, rules, accounts] = await db.snapshot(() =>
        Promise.all([repo.allLabels(), repo.allAliases(), repo.allRules(), repo.allAccounts()]),
      );
      const byId = new Map(rows.map((l) => [l.id, l]));
      const labelOfAccount = new Map(accounts.map((a) => [a.account, a.labelId]));
      const byAlias = new Map(aliases.map((a) => [a.aliasNorm, a.labelId]));
      const rulesOf = new Map<string, RuleRow[]>();
      for (const r of rules) rulesOf.set(r.labelId, [...(rulesOf.get(r.labelId) ?? []), r]);
      return {
        normalize: normalizeLabelString,
        /** The name of a label by id (the label of record of a sublabel is its own label). */
        labelName: (id: string): string | undefined => byId.get(id)?.name,
        /** The own label a Believe account is registered under (D-168), undefined for an unregistered account. */
        labelOfAccount: (account: string): string | undefined => labelOfAccount.get(account),
        /** Every own label (id, name), by name. */
        ownLabels: (): { id: string; name: string }[] =>
          rows.filter((l) => l.kind === 'own').map((l) => ({ id: l.id, name: l.name })),
        /** Every document of a rule (the facade asks module 1 for their status). */
        documentIds: (): string[] => [
          ...new Set(rules.map((r) => r.documentId).filter((d): d is string => !!d)),
        ],
        /** The label of a Believe string and its rule in force at a date; undefined for an unknown string. */
        labelOf(labelString: string, date: IsoDate): LabelOfRecord | undefined {
          const l = byId.get(byAlias.get(normalizeLabelString(labelString)) ?? '');
          if (!l) return undefined;
          const r = (rulesOf.get(l.id) ?? []).find((x) => covers(x, date));
          return {
            id: l.id,
            name: l.name,
            kind: l.kind,
            ownLabelId: l.ownLabelId,
            rule: r
              ? {
                  id: r.id,
                  percent: new Decimal(r.percent),
                  recipientArtistId: r.recipientArtistId,
                  documentId: r.documentId,
                }
              : null,
          };
        },
      };
    },
  };
  return service;
}

export type LabelsService = ReturnType<typeof createLabelsService>;
export type LabelsIndex = Awaited<ReturnType<LabelsService['index']>>;
