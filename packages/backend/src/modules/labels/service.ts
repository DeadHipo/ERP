import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors';
import { newId } from '../../shared/identifiers';
import { nowIso } from '../../shared/dates';
import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import type { AccountRow, AliasRow, LabelRow, SublabelRow } from './repository';
import { createLabelsRepository } from './repository';

/** A sublabel of the register (D-217): a name only. */
export interface SublabelView {
  id: string;
  name: string;
  createdAt: string;
}

const sublabelView = (r: SublabelRow): SublabelView => ({ id: r.id, name: r.name, createdAt: r.createdAt });

/** An own label (since D-232 the only kind): its Believe strings and its Believe accounts. */
export interface LabelView {
  id: string;
  name: string;
  aliases: string[];
  /** The Believe accounts of the label (D-168). */
  accounts: string[];
}

export interface LabelOfRecord {
  id: string;
  name: string;
}

/** Alias normalisation: NFKC, lower case, white space collapsed and trimmed. */
export const normalizeLabelString = (raw: string): string =>
  raw.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function createLabelsService(db: Db, org: OrgScope) {
  const repo = createLabelsRepository(db, org);

  const view = (l: LabelRow, aliases: AliasRow[], accounts: AccountRow[]): LabelView => ({
    id: l.id,
    name: l.name,
    aliases: aliases.filter((a) => a.labelId === l.id).map((a) => a.alias),
    accounts: accounts.filter((a) => a.labelId === l.id).map((a) => a.account),
  });

  const service = {
    /** An own label (D-232: the only kind; a sublabel is the register, D-217). */
    async createLabel(input: { name: string }): Promise<LabelView> {
      const name = input.name.trim();
      if (!name) throw new ValidationError('Label name is empty');
      return repo.transaction(async () => {
        // one name per organization (labels_org_name, D-170); writes are serialized, so the check holds at insert
        if (await repo.labelByName(name))
          throw new ConflictError(`A label named "${name}" already exists`, 'label_name_taken');
        const id = newId();
        await repo.insertLabel({ id, name, createdAt: nowIso() });
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

    async getLabel(id: string): Promise<LabelView> {
      const l = await repo.getLabel(id);
      if (!l) throw new NotFoundError('Label', id);
      const [aliases, accounts] = await db.snapshot(() => Promise.all([repo.allAliases(), repo.allAccounts()]));
      return view(l, aliases, accounts);
    },

    /** A Believe account of an own label (D-168): an account belongs to one label. */
    async addAccount(labelId: string, accountRaw: string): Promise<LabelView> {
      const account = accountRaw.trim();
      if (!account) throw new ValidationError('Account is empty');
      return repo.transaction(async () => {
        const l = await repo.getLabel(labelId);
        if (!l) throw new NotFoundError('Label', labelId);
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
    ): Promise<{ id: string; name: string }[]> {
      const needle = q.trim();
      if (!needle) return [];
      return (await repo.searchLabels(needle, limit)).map((l) => ({ id: l.id, name: l.name }));
    },

    async listLabels(): Promise<LabelView[]> {
      const [rows, aliases, accounts] = await db.snapshot(() => Promise.all([repo.allLabels(), repo.allAliases(), repo.allAccounts()]));
      return rows.map((l) => view(l, aliases, accounts));
    },

    /** In-memory index, built once per facade calculation (one consistent read of the module). */
    async index() {
      const [rows, aliases, accounts] = await db.snapshot(() => Promise.all([repo.allLabels(), repo.allAliases(), repo.allAccounts()]));
      const byId = new Map(rows.map((l) => [l.id, l]));
      const labelOfAccount = new Map(accounts.map((a) => [a.account, a.labelId]));
      const byAlias = new Map(aliases.map((a) => [a.aliasNorm, a.labelId]));
      return {
        normalize: normalizeLabelString,
        /** The name of a label by id. */
        labelName: (id: string): string | undefined => byId.get(id)?.name,
        /** The own label a Believe account is registered under (D-168), undefined for an unregistered account. */
        labelOfAccount: (account: string): string | undefined => labelOfAccount.get(account),
        /** Every own label (id, name), by name. */
        ownLabels: (): { id: string; name: string }[] => rows.map((l) => ({ id: l.id, name: l.name })),
        /** The own label of a Believe string; undefined for an unknown string. */
        labelOf(labelString: string): LabelOfRecord | undefined {
          const l = byId.get(byAlias.get(normalizeLabelString(labelString)) ?? '');
          return l ? { id: l.id, name: l.name } : undefined;
        },
      };
    },

    /** The sublabels (D-217), by name. */
    async listSublabels(): Promise<SublabelView[]> {
      return (await repo.allSublabels()).map(sublabelView);
    },

    async getSublabel(id: string): Promise<SublabelView> {
      const r = await repo.getSublabel(id);
      if (!r) throw new NotFoundError('Sublabel', id);
      return sublabelView(r);
    },

    /** A new sublabel: a name, unique in the organization without case (409 `sublabel_name_taken`). */
    async createSublabel(nameRaw: string): Promise<SublabelView> {
      const name = nameRaw.trim();
      if (!name) throw new ValidationError('Sublabel name is empty');
      return repo.transaction(async () => {
        if (await repo.sublabelByName(name))
          throw new ConflictError(`A sublabel named "${name}" already exists`, 'sublabel_name_taken');
        const row: SublabelRow = { id: newId(), name, createdAt: nowIso() };
        await repo.insertSublabel(row);
        return sublabelView(row);
      });
    },

    /** Renames a sublabel; the same rule of a unique name. */
    async renameSublabel(id: string, nameRaw: string): Promise<SublabelView> {
      const name = nameRaw.trim();
      if (!name) throw new ValidationError('Sublabel name is empty');
      return repo.transaction(async () => {
        if (!(await repo.getSublabel(id))) throw new NotFoundError('Sublabel', id);
        const same = await repo.sublabelByName(name);
        if (same && same.id !== id)
          throw new ConflictError(`A sublabel named "${name}" already exists`, 'sublabel_name_taken');
        await repo.renameSublabel(id, name);
        return service.getSublabel(id);
      });
    },
  };
  return service;
}

export type LabelsService = ReturnType<typeof createLabelsService>;
export type LabelsIndex = Awaited<ReturnType<LabelsService['index']>>;
