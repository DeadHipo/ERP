import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
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
import { useMe } from '../api/queries/auth';
import { labelQueries } from '../api/queries/labels';
import { getStoredLabel, setStoredLabel } from '../lib/label';
import { useWorkOrg } from '../lib/session';
import { ru } from '../i18n/ru';

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

/** A stored label of the switch that is not an own label of this organization is dropped (another user, D-170). */
function ForeignLabelReset() {
  const labels = useQuery(labelQueries.list());
  useEffect(() => {
    if (!labels.data) return;
    const stored = getStoredLabel();
    if (stored && !labels.data.some((l) => l.kind === 'own' && l.id === stored)) setStoredLabel('');
  }, [labels.data]);
  return null;
}

function SessionShell({ me }: { me: Me }) {
  const { pathname } = useLocation();
  const workOrg = useWorkOrg();
  const admin = me.user?.isSystemAdmin === true;
  // a system administrator without a chosen organization has only the system pages (every other read is 400 org_required)
  const outsideOrg = admin && workOrg === '';
  if (outsideOrg && !pathname.startsWith('/system')) return <Navigate to="/system/orgs" replace />;
  return (
    <BreadcrumbLabelProvider>
      <div className="flex h-full bg-background text-foreground">
        <Sidebar isSystemAdmin={admin} inOrg={!outsideOrg} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
            <Breadcrumbs />
            <div className="flex items-center gap-4">
              <RecalcIndicator />
              {outsideOrg ? null : (
                <>
                  <ForeignLabelReset />
                  <GlobalSearch />
                  <LabelSwitch />
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
