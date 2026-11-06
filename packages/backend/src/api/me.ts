import { allowedOperations, localPrincipal, principalOfUser, supportPrincipal, type Principal } from '../auth/abilities';
import type { AuthConfig } from '../auth/middleware';
import { meOf, type AuthService, type MeRole, type SessionUser } from '../auth/service';
import type { Facade } from '../facade';
import type { OrgsService } from '../orgs/service';
import { API_OPERATIONS, operationKey } from './operations';

/** Every operation with its ability, for `me.abilities` (D-171). */
const OPERATION_ABILITIES = API_OPERATIONS.map((o) => ({ key: operationKey(o), ability: o.ability }));

/** A live support grant of the system administrator in an organization (D-171). */
export interface SupportContext {
  orgId: string;
  expiresAt: string;
  write: boolean;
}

/**
 * The answer of `GET /auth/me`, `POST /auth/login` and `POST /orgs/:id/support/enter` (D-171): the role, the labels,
 * the memberships and the operations the session may call. Under a support grant the system administrator is
 * `support` in that organization (every own label, `allLabels`) and keeps the system operations.
 */
export function createMe(deps: {
  auth: AuthService;
  config: AuthConfig;
  orgs: OrgsService;
  facadeOf: (orgId: string) => Promise<Facade>;
}) {
  const { auth, config, orgs, facadeOf } = deps;

  /** The own labels of an organization, by name. */
  async function ownLabels(orgId: string): Promise<{ id: string; name: string }[]> {
    const all = await (await facadeOf(orgId)).modules.labels.listLabels();
    return all
      .filter((l) => l.kind === 'own')
      .map((l) => ({ id: l.id, name: l.name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  return async function me(user: SessionUser | undefined, support?: SupportContext) {
    const orgId = config.mode === 'off' ? config.defaultOrg : support ? support.orgId : (user?.orgId ?? undefined);
    const org = orgId ? await orgs.findOrganization(orgId) : undefined;
    let role: MeRole | null = null;
    let labels: { id: string; name: string }[] = [];
    let allLabels = false;
    const principals: Principal[] = [];
    if (config.mode === 'off') {
      role = 'local';
      allLabels = true;
      if (org) labels = await ownLabels(org.id);
      principals.push(localPrincipal(org?.id ?? null));
    } else if (user?.isSystemAdmin) {
      role = 'system';
      principals.push(principalOfUser(user));
      if (support && org) {
        role = 'support';
        allLabels = true;
        labels = await ownLabels(org.id);
        principals.push(supportPrincipal(user, org.id, support.write));
      }
    } else if (user && org) {
      role = user.role;
      const own = await ownLabels(org.id);
      allLabels = user.role === 'org_admin';
      labels = allLabels ? own : own.filter((l) => user.labelIds.includes(l.id));
      principals.push(principalOfUser(user));
    } else if (user) principals.push(principalOfUser(user));
    const memberships = user && config.mode === 'on' ? await auth.memberships(user.id) : [];
    // the abilities of the principals, without a request label (a manager's label operations count with one label)
    const abilities = [...new Set(principals.flatMap((p) => allowedOperations(p, OPERATION_ABILITIES)))];
    return meOf({
      mode: config.mode,
      user,
      org,
      role,
      labels,
      allLabels,
      memberships,
      abilities,
      support: support && org && role === 'support' ? support : null,
    });
  };
}
