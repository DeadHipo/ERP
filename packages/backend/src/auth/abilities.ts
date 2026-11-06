// What each kind of principal may do (D-171): one table, `RULES`, kind × action × scope. Pure functions: no express,
// no database. The operations of the API carry their `ability` (`api/operations.ts`); `authorize` (organization
// router) and the system router ask `can()`; `GET /auth/me` lists `allowedOperations()` for the UI. Record-dependent
// checks (scope `record`: the label of the record the request touches) are the facade's, through its own `Viewer`
// type: the facade never imports this file.

/**
 * `read` without money; `read_money`; `write` catalogue or data without money and without approval; `approve`
 * approval, confirmation, a move between books, binding income to an owner; `pay` a money operation; `admin` the
 * settings of the organization (labels, accounts, rules, users, support); `system` a system operation; `self` the
 * user's own session.
 */
export type Action = 'read' | 'read_money' | 'write' | 'approve' | 'pay' | 'admin' | 'system' | 'self';
export const ACTIONS: readonly Action[] = ['read', 'read_money', 'write', 'approve', 'pay', 'admin', 'system', 'self'];

/**
 * The label an operation of an organization acts under: `label` the label of the request (`?label=`, `body.labelId`,
 * `body.items[].labelId`), required for a manager and one of theirs; `record` the label of the record (the facade
 * checks it); `org` no label, the whole organization.
 */
export type Scope = 'label' | 'record' | 'org';
export const SCOPES: readonly Scope[] = ['label', 'record', 'org'];

export type Subject =
  | 'session'
  | 'orgs'
  | 'users'
  | 'support'
  | 'catalog'
  | 'owners'
  | 'artists'
  | 'tracks'
  | 'releases'
  | 'documents'
  | 'splits'
  | 'labels'
  | 'sources'
  | 'publishing'
  | 'reports'
  | 'settlements'
  | 'audit'
  | 'ads';

/** The right an operation needs; `scope` only on the operations of an organization. */
export interface Ability {
  action: Action;
  subject: Subject;
  scope?: Scope;
}

export type PrincipalKind = 'org_admin' | 'label_manager' | 'support' | 'system' | 'local';

/**
 * Who asks: a member (`org_admin`, `label_manager` with own labels), the system administrator or the system key
 * (`system`), the system administrator in an organization under a grant (`support`), or `AUTH_MODE=off` (`local`,
 * acts as `org_admin`).
 */
export interface Principal {
  kind: PrincipalKind;
  userId: string | null;
  login: string | null;
  orgId: string | null;
  sessionId: string | null;
  /** The labels the principal works under: `all` for `org_admin`, `support`, `local`; none for `system`. */
  labelIds: ReadonlySet<string> | 'all';
  /** A support grant with `write: true`. */
  supportWrite: boolean;
}

export type Refusal = 'forbidden' | 'label_required' | 'label_forbidden' | 'support_required' | 'support_read_only';
export type Decision = { ok: true } | { ok: false; status: 400 | 403; code: Refusal };

/** The labels a request names (`?label=`, `body.labelId`, `body.items[].labelId`); `itemWithout`: an item has none. */
export interface RequestLabels {
  labelIds: readonly string[];
  itemWithout?: boolean;
}

/**
 * `allow`; `own_label` the request names labels, all of them the principal's (none = `label_required`); `record` the
 * facade checks the label of the record; `support_write` allowed under a grant with write; or a refusal.
 */
type Verdict = 'allow' | 'own_label' | 'record' | 'support_write' | Refusal;
type Rule = Verdict | Readonly<Record<Scope, Verdict>>;

const ADMIN: Record<Action, Rule> = {
  read: 'allow',
  read_money: 'allow',
  write: 'allow',
  approve: 'allow',
  pay: 'allow',
  admin: 'allow',
  system: 'forbidden',
  self: 'allow',
};

/** The one table of rights (plan §1 «Матрица правил»). */
export const RULES: Readonly<Record<PrincipalKind, Readonly<Record<Action, Rule>>>> = {
  org_admin: ADMIN,
  local: ADMIN,
  label_manager: {
    read: { label: 'own_label', record: 'record', org: 'allow' },
    read_money: { label: 'own_label', record: 'record', org: 'forbidden' },
    write: { label: 'own_label', record: 'record', org: 'allow' },
    approve: 'forbidden',
    pay: 'forbidden',
    admin: 'forbidden',
    system: 'forbidden',
    self: 'allow',
  },
  support: {
    read: 'allow',
    read_money: 'allow',
    write: 'support_write',
    approve: 'forbidden',
    pay: 'forbidden',
    admin: 'forbidden',
    system: 'forbidden',
    self: 'allow',
  },
  system: {
    read: 'support_required',
    read_money: 'support_required',
    write: 'support_required',
    approve: 'support_required',
    pay: 'support_required',
    admin: 'support_required',
    system: 'allow',
    self: 'allow',
  },
};

function verdictOf(p: Principal, a: Ability): Verdict {
  const rule = RULES[p.kind][a.action];
  return typeof rule === 'string' ? rule : rule[a.scope ?? 'org'];
}

const refuse = (code: Refusal): Decision => ({ ok: false, status: code === 'label_required' ? 400 : 403, code });

/**
 * May `p` call an operation needing `a` with the labels the request names? A refusal of the action comes first
 * (`forbidden`, `support_*`); then any label of the request that is not the principal's is `label_forbidden` (whatever
 * the scope); then a `label` operation of a principal with own labels needs one (`label_required`). `record` passes
 * here: the facade checks the record's label.
 */
export function can(p: Principal, a: Ability, req: RequestLabels): Decision {
  const v = verdictOf(p, a);
  if (v === 'support_write') {
    if (!p.supportWrite) return refuse('support_read_only');
  } else if (v !== 'allow' && v !== 'own_label' && v !== 'record') return refuse(v);
  if (p.labelIds !== 'all') {
    const own = p.labelIds;
    if (req.labelIds.some((id) => !own.has(id))) return refuse('label_forbidden');
    if (v === 'own_label' && (req.labelIds.length === 0 || req.itemWithout)) return refuse('label_required');
  }
  return { ok: true };
}

/**
 * The operations `p` may call, without the data (`GET /auth/me.abilities`, the UI closes the rest): a `label`
 * operation counts when the principal has at least one label; `record` operations count (the record decides later).
 */
export function allowedOperations(p: Principal, ops: readonly { key: string; ability?: Ability }[]): string[] {
  const hasLabel = p.labelIds === 'all' || p.labelIds.size > 0;
  return ops
    .filter((o) => {
      if (!o.ability) return false;
      if (verdictOf(p, o.ability) === 'own_label') return hasLabel;
      return can(p, o.ability, { labelIds: [] }).ok;
    })
    .map((o) => o.key);
}

/** The principal of `AUTH_MODE=off` (tests, scripts, the local stand): acts as `org_admin` in ERP_DEFAULT_ORG. */
export const localPrincipal = (orgId: string | null): Principal => ({
  kind: 'local',
  userId: null,
  login: null,
  orgId,
  sessionId: null,
  labelIds: 'all',
  supportWrite: false,
});

/** The principal of a signed-in user: a system administrator, or a member with the role of the session's organization. */
export function principalOfUser(user: {
  id: string;
  login: string;
  isSystemAdmin: boolean;
  orgId: string | null;
  role: 'org_admin' | 'label_manager' | null;
  labelIds: readonly string[];
  sessionId: string | null;
}): Principal {
  const base = { userId: user.id, login: user.login, sessionId: user.sessionId, supportWrite: false };
  if (user.isSystemAdmin || user.role === null) return { ...base, kind: 'system', orgId: null, labelIds: new Set() };
  if (user.role === 'org_admin') return { ...base, kind: 'org_admin', orgId: user.orgId, labelIds: 'all' };
  return { ...base, kind: 'label_manager', orgId: user.orgId, labelIds: new Set(user.labelIds) };
}

/** The principal of the system key (no user). */
export const systemKeyPrincipal = (): Principal => ({
  kind: 'system',
  userId: null,
  login: null,
  orgId: null,
  sessionId: null,
  labelIds: new Set(),
  supportWrite: false,
});

/** `approve:documents`: the ability as the `details.ability` of a `403 forbidden`. */
export const abilityName = (a: Ability): string => `${a.action}:${a.subject}`;

/**
 * The principal of the system administrator working in an organization under a live support grant (D-171): every
 * book, read and read money; write only with a write grant; never approve, pay or admin.
 */
export const supportPrincipal = (
  user: { id: string; login: string; sessionId: string | null },
  orgId: string,
  write: boolean,
): Principal => ({
  kind: 'support',
  userId: user.id,
  login: user.login,
  orgId,
  sessionId: user.sessionId,
  labelIds: 'all',
  supportWrite: write,
});
