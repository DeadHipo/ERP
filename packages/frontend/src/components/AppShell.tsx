import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Breadcrumbs } from './Breadcrumbs';
import { GlobalSearch } from './GlobalSearch';
import { OperatorField } from './OperatorField';
import { RecalcIndicator } from './RecalcIndicator';
import { ThemeToggle } from './ThemeToggle';
import { BreadcrumbLabelProvider } from './breadcrumb-label';
import { ru } from '../i18n/ru';

/** Sidebar + header (breadcrumbs, search, recalc indicator, operator, theme) + the routed page. */
export function AppShell() {
  return (
    <BreadcrumbLabelProvider>
      <div className="flex h-full bg-background text-foreground">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
            <Breadcrumbs />
            <div className="flex items-center gap-4">
              <RecalcIndicator />
              <GlobalSearch />
              <OperatorField />
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
