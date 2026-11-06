import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  allowedOperations,
  can,
  localPrincipal,
  principalOfUser,
  RULES,
  SCOPES,
  systemKeyPrincipal,
  type Principal,
} from '../src/auth/abilities';
import { API_OPERATIONS, isOrgOperation, operationKey, operationOf } from '../src/api/operations';
import { MANAGER_ANSWER } from './helpers/manager-answers';

// The abilities table (D-171). The expected answers to a label manager are a FROZEN literal (plan «этап3_роли.md» §1,
// column «Мен.»), not derived from RULES: a wrong class on an operation (`/owners/merge` as `write`) fails here.

const A = 'label-a';
const A2 = 'label-a2';
const B = 'label-b';

const manager = (labels: string[] = [A]): Principal =>
  principalOfUser({ id: 'u', login: 'm', isSystemAdmin: false, orgId: 'o', role: 'label_manager', labelIds: labels, sessionId: 's' });
const orgAdmin = principalOfUser({ id: 'u', login: 'a', isSystemAdmin: false, orgId: 'o', role: 'org_admin', labelIds: [], sessionId: 's' });
const sysAdmin = principalOfUser({ id: 'u', login: 's', isSystemAdmin: true, orgId: null, role: null, labelIds: [], sessionId: 's' });
const support = (write: boolean): Principal => ({ ...orgAdmin, kind: 'support', supportWrite: write });

const orgOps = API_OPERATIONS.filter(isOrgOperation);
const systemOps = API_OPERATIONS.filter((o) => o.access === 'system');
const decide = (p: Principal, key: string, labelIds: string[], itemWithout = false) => {
  const op = API_OPERATIONS.find((o) => operationKey(o) === key);
  if (!op?.ability) throw new Error(`no ability: ${key}`);
  const d = can(p, op.ability, { labelIds, itemWithout });
  return d.ok ? 'ok' : `${d.status} ${d.code}`;
};

describe('abilities (D-171)', () => {
  it('the frozen literal names exactly the operations of an organization; the counts of the plan', () => {
    expect(Object.keys(MANAGER_ANSWER).sort()).toEqual(orgOps.map(operationKey).sort());
    const count = (c: string) => Object.values(MANAGER_ANSWER).filter((v) => v === c).length;
    // D-174: + GET /settlements/start (L), POST /settlements/start/import (x), POST /settlements/start/:id/deactivate (x)
    expect([orgOps.length, count('L'), count('R'), count('O'), count('x')]).toEqual([97, 31, 16, 7, 43]);
    const byAction = (a: string) => orgOps.filter((o) => o.ability.action === a).length;
    expect(['read', 'read_money', 'write', 'approve', 'pay', 'admin'].map(byAction)).toEqual([19, 23, 17, 14, 10, 14]);
  });

  it('a label manager gets exactly the literal on every operation of an organization', () => {
    const m = manager();
    for (const o of orgOps) {
      const key = operationKey(o);
      const expected = {
        L: { mine: 'ok', none: '400 label_required', other: '403 label_forbidden' },
        R: { mine: 'ok', none: 'ok', other: '403 label_forbidden' },
        O: { mine: 'ok', none: 'ok', other: '403 label_forbidden' },
        x: { mine: '403 forbidden', none: '403 forbidden', other: '403 forbidden' },
      }[MANAGER_ANSWER[key] as 'L' | 'R' | 'O' | 'x'];
      expect(
        { mine: decide(m, key, [A]), none: decide(m, key, []), other: decide(m, key, [B]) },
        key,
      ).toEqual(expected);
    }
    // two labels named, one of them another's: refused; an item of a batch without a label: label_required
    expect(decide(manager([A, A2]), 'GET /owners', [A, A2])).toBe('ok');
    expect(decide(manager([A, A2]), 'POST /ads', [A, B])).toBe('403 label_forbidden');
    expect(decide(m, 'POST /ads', [A], true)).toBe('400 label_required');
    expect(decide(orgAdmin, 'POST /ads', [], true)).toBe('ok'); // the facade answers the administrator
  });

  it('org_admin and local may call every operation of an organization under any label, and no system one', () => {
    for (const p of [orgAdmin, localPrincipal('o')]) {
      for (const o of orgOps) for (const labels of [[], [A], [B]]) expect(decide(p, operationKey(o), labels), operationKey(o)).toBe('ok');
      for (const o of systemOps) expect(decide(p, operationKey(o), [])).toBe('403 forbidden');
    }
    expect(RULES.local).toEqual(RULES.org_admin);
  });

  it('the system administrator and the key: the system operations only; an organization needs support', () => {
    for (const p of [sysAdmin, systemKeyPrincipal()]) {
      expect(p.kind).toBe('system');
      for (const o of systemOps) expect(decide(p, operationKey(o), [])).toBe('ok');
      for (const o of orgOps) expect(decide(p, operationKey(o), [])).toBe('403 support_required');
    }
  });

  it('support: reads with money, writes only with a write grant, never approve, pay or admin', () => {
    for (const o of orgOps) {
      const key = operationKey(o);
      const a = o.ability.action;
      const read = a === 'read' || a === 'read_money';
      expect(decide(support(false), key, []), key).toBe(read ? 'ok' : a === 'write' ? '403 support_read_only' : '403 forbidden');
      expect(decide(support(true), key, []), key).toBe(read || a === 'write' ? 'ok' : '403 forbidden');
    }
  });

  it('the pure table: every kind × action × scope × label (own / another / none)', () => {
    const kinds: Principal[] = [orgAdmin, localPrincipal('o'), manager(), support(false), support(true), sysAdmin];
    const expected = (p: Principal, action: string, scope: string, labels: 'own' | 'other' | 'none'): string => {
      // a label the principal does not have is refused whatever the action (the system ones have none)
      const foreign = p.labelIds !== 'all' && (labels === 'other' || (labels === 'own' && p.kind === 'system'));
      if (action === 'self') return foreign ? '403 label_forbidden' : 'ok';
      if (p.kind === 'system') return action === 'system' ? (foreign ? '403 label_forbidden' : 'ok') : '403 support_required';
      if (action === 'system') return '403 forbidden';
      if (p.kind === 'org_admin' || p.kind === 'local') return 'ok';
      if (p.kind === 'support') {
        if (action === 'read' || action === 'read_money') return 'ok';
        if (action === 'write') return p.supportWrite ? 'ok' : '403 support_read_only';
        return '403 forbidden';
      }
      // label_manager
      if (!['read', 'read_money', 'write'].includes(action)) return '403 forbidden';
      if (action === 'read_money' && scope === 'org') return '403 forbidden';
      if (labels === 'other') return '403 label_forbidden';
      if (scope === 'label' && labels === 'none') return '400 label_required';
      return 'ok';
    };
    for (const p of kinds)
      for (const action of ACTIONS)
        for (const scope of SCOPES)
          for (const labels of ['own', 'other', 'none'] as const) {
            const ids = labels === 'own' ? [A] : labels === 'other' ? [B] : [];
            const d = can(p, { action, subject: 'owners', scope }, { labelIds: ids });
            expect(d.ok ? 'ok' : `${d.status} ${d.code}`, `${p.kind}${p.supportWrite ? '+w' : ''} ${action} ${scope} ${labels}`).toBe(
              expected(p, action, scope, labels),
            );
          }
  });

  it('allowedOperations: the manager none of approve / pay / admin / money of the organization; the administrator every org operation', () => {
    const ops = API_OPERATIONS.map((o) => ({ key: operationKey(o), ability: o.ability }));
    const m = allowedOperations(manager(), ops);
    const orgAllowed = m.filter((k) => MANAGER_ANSWER[k] !== undefined).sort();
    expect(orgAllowed).toEqual(
      Object.entries(MANAGER_ANSWER)
        .filter(([, v]) => v !== 'x')
        .map(([k]) => k)
        .sort(),
    );
    expect(orgAllowed).toHaveLength(54); // D-174: + GET /settlements/start
    expect(m).toEqual(expect.arrayContaining(['GET /auth/me', 'POST /auth/password']));
    expect(m.filter((k) => k.startsWith('GET /orgs') || k.startsWith('POST /orgs'))).toEqual([]);
    // a manager without labels: no label operation
    const bare = allowedOperations(manager([]), ops);
    expect(bare.filter((k) => MANAGER_ANSWER[k] === 'L')).toEqual([]);
    const admin = allowedOperations(orgAdmin, ops);
    expect(admin.sort()).toEqual(API_OPERATIONS.filter((o) => o.access === 'org' || o.access === 'user').map(operationKey).sort());
    expect(allowedOperations(localPrincipal('o'), ops).sort()).toEqual(admin);
    expect(allowedOperations(sysAdmin, ops).sort()).toEqual(
      API_OPERATIONS.filter((o) => o.access === 'system' || o.access === 'user').map(operationKey).sort(),
    );
  });

  it('operationOf finds every operation on its own path, as Express matches (case, trailing slash), and nothing else', () => {
    for (const o of API_OPERATIONS) {
      const concrete = o.path.replace(/:([A-Za-z]+)/g, 'x1');
      expect(operationOf(o.method, concrete), operationKey(o)).toBe(o);
      expect(operationOf(o.method.toUpperCase(), concrete.toUpperCase().replace(/X1/g, 'x1') + '/'), operationKey(o)).toBe(o);
    }
    const key = (m: string, p: string) => {
      const op = operationOf(m, p);
      return op ? operationKey(op) : undefined;
    };
    expect(key('POST', '/Owners/merge')).toBe('POST /owners/merge');
    expect(key('post', '/owners/merge/')).toBe('POST /owners/merge');
    expect(key('GET', '/owners/payables')).toBe('GET /owners/payables');
    expect(key('GET', '/owners/some-id')).toBe('GET /owners/:id');
    expect(key('GET', '/artists/duplicates')).toBe('GET /artists/duplicates');
    expect(key('GET', '/ads/summary')).toBe('GET /ads/summary');
    expect(key('POST', '/labels/rules/r1/close')).toBe('POST /labels/rules/:id/close');
    expect(key('POST', '/labels/l1/rules')).toBe('POST /labels/:id/rules');
    expect(key('HEAD', '/owners')).toBe('GET /owners');
    expect(key('GET', '/owners/merge')).toBe('GET /owners/:id'); // the GET route Express would serve
    for (const [m, p] of [
      ['GET', '/nothing'],
      ['DELETE', '/owners/x'],
      ['POST', '/owners/merge//'],
      ['GET', '/owners//'],
      ['GET', '/owners/x/y/z'],
      ['OPTIONS', '/owners'],
      ['GET', ''],
    ] as const)
      expect(key(m, p), `${m} ${p}`).toBeUndefined();
  });
});
