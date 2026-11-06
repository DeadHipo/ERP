import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@heroui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@erp/shared/api-responses';
import { Sidebar } from './Sidebar';
import { Breadcrumbs } from './Breadcrumbs';
import { GlobalSearch } from './GlobalSearch';
import { OperatorField } from './OperatorField';
import { LabelSwitch } from './LabelSwitch';
import { PageState } from './PageState';
import { RecalcIndicator } from './RecalcIndicator';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { BreadcrumbLabelProvider } from './breadcrumb-label';
import { authQueries, useMe } from '../api/queries/auth';
import { labelQueries } from '../api/queries/labels';
import { useLabel } from '../lib/label';
import { isAllowed } from '../lib/abilities';
import { formatDateTime } from '../lib/datetime';
import { setWorkOrg, useWorkOrg } from '../lib/session';
import { homeFor, navFor } from '../nav';
import { fmt, ru } from '../i18n/ru';

/**
 * Sidebar + header (breadcrumbs, search, recalc indicator, the label switch, the user or the operator, theme) + the
 * routed page. Nothing renders before `GET /auth/me` answers (D-170): with the login on (`authMode: 'on'`) the header
 * shows `UserMenu` and the operator of every write is the login; off, the operator field as before. A 401 has already
 * sent the browser to `/login` (`call()`).
 */
export function AppShell() {
  const me = useMe();
  if (me.data === undefined) {
    if (me.isError) return <PageState variant="error" error={me.error} onRetry={() => void me.refetch()} />;
    return (
      <div className="flex h-full items-center justify-center" data-testid="session-loading">
        <Spinner aria-label={ru.auth.checking} />
      </div>
    );
  }
  return <SessionShell me={me.data} />;
}

/**
 * The label of the switch must be one the session may choose (D-170, D-171): a stored or linked label that is not an
 * own label of this organization (another user) or, for a label manager, not one of `me.labels` is dropped: to «Все»
 * when the session has it, else to the user's first label (a manager never stays under «Все»).
 */
function ForeignLabelReset({ me }: { me: Me }) {
  const labels = useQuery(labelQueries.list());
  const { requested: labelId, setLabel } = useLabel();
  useEffect(() => {
    if (!labels.data) return;
    const own = labels.data.filter((l) => l.kind === 'own').map((l) => l.id);
    const allowed = me.allLabels ? own : own.filter((id) => me.labels.some((l) => l.id === id));
    if (labelId === '' ? me.allLabels : allowed.includes(labelId)) return;
    setLabel(me.allLabels ? '' : (allowed[0] ?? ''));
  }, [labels.data, labelId, me, setLabel]);
  return null;
}

/**
 * A system administrator works in an organization only under a live support grant (D-171): `GET /auth/me` with
 * `X-Org` answers the role `support` then. The answer in the cache may predate the choice of the organization (the
 * query cache notifies after React renders the new `erp.org`): `me` is asked again with it, and only when it is still
 * not support (expired, revoked) the chosen organization is left.
 */
function CheckSupport() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let live = true;
    void queryClient
      .fetchQuery({ ...authQueries.me(), staleTime: 0 })
      .catch(() => null)
      .then((me) => {
        if (!live || me?.role === 'support') return;
        setWorkOrg('');
        queryClient.clear();
      });
    return () => {
      live = false;
    };
  }, [queryClient]);
  return (
    <div className="flex h-full items-center justify-center" data-testid="session-loading">
      <Spinner aria-label={ru.auth.checking} />
    </div>
  );
}

/** The support mode (D-171): the organization's data under a grant, read-only unless the grant allows writes. */
function SupportBanner({ support }: { support: NonNullable<Me['support']> }) {
  const t = ru.shell.support;
  return (
    <span
      className="rounded-full bg-warning/15 px-2 py-0.5 text-xs text-warning"
      data-testid="support-banner"
      data-write={support.write}
    >
      {fmt(t.banner, { until: formatDateTime(support.expiresAt) })} · {support.write ? t.write : t.readOnly}
    </span>
  );
}

function SessionShell({ me }: { me: Me }) {
  const { pathname } = useLocation();
  const workOrg = useWorkOrg();
  const admin = me.user?.isSystemAdmin === true;
  const support = admin && workOrg !== '' && me.role === 'support';
  // a system administrator without a chosen organization has only the system pages (every other read is 400 org_required)
  const outsideOrg = admin && !support;
  const sections = navFor({ isSystemAdmin: admin, inOrg: !outsideOrg }, me);
  if (admin && workOrg !== '' && !support) return <CheckSupport />;
  if (outsideOrg && !pathname.startsWith('/system')) return <Navigate to="/system/orgs" replace />;
  // a label manager has no overview: the home is the first page of the sidebar (D-171)
  if (pathname === '/' && !outsideOrg && !isAllowed(me, 'GET /overview') && homeFor(sections) !== '/')
    return <Navigate to={homeFor(sections)} replace />;
  return (
    <BreadcrumbLabelProvider>
      <div className="flex h-full bg-background text-foreground">
        <Sidebar sections={sections} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
            <Breadcrumbs />
            <div className="flex items-center gap-4">
              <RecalcIndicator />
              {support && me.support ? <SupportBanner support={me.support} /> : null}
              {outsideOrg ? null : (
                <>
                  <ForeignLabelReset me={me} />
                  <GlobalSearch />
                  <LabelSwitch me={me} />
                </>
              )}
              {me.authMode === 'on' ? <UserMenu me={me} /> : <OperatorField />}
              <ThemeToggle />
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-auto p-6" data-testid="page">
            <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </BreadcrumbLabelProvider>
  );
}
