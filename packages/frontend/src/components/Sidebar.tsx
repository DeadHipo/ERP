import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { isItemActive, navFor } from '../nav';
import { readStorage, writeStorage } from '../lib/storage';
import { ru } from '../i18n/ru';

const KEY = 'erp.sidebar';

/**
 * The sidebar from nav.ts; collapsible, the state is kept in sessionStorage. A system administrator also sees the
 * system section (D-170), alone while they work in no organization.
 */
export function Sidebar(props: { isSystemAdmin?: boolean; inOrg?: boolean }) {
  const sections = navFor({ isSystemAdmin: props.isSystemAdmin === true, inOrg: props.inOrg !== false });
  const { pathname, search } = useLocation();
  const [collapsed, setCollapsed] = useState(() => readStorage('session', KEY) === 'collapsed');
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeStorage('session', KEY, next ? 'collapsed' : 'open');
  };
  return (
    <aside
      data-testid="sidebar"
      data-collapsed={collapsed}
      style={{ width: collapsed ? 'var(--shell-sidebar-width-collapsed)' : 'var(--shell-sidebar-width)' }}
      className="flex shrink-0 flex-col border-r border-border bg-surface-secondary transition-[width]"
    >
      <div className="flex h-14 items-center gap-2 px-3">
        <button
          type="button"
          data-testid="sidebar-toggle"
          aria-label={collapsed ? ru.nav.expand : ru.nav.collapse}
          onClick={toggle}
          className="rounded-md p-1.5 hover:bg-default"
        >
          <Bars3Icon className="size-5" />
        </button>
        {collapsed ? null : <span className="font-semibold">{ru.common.appName}</span>}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {sections.map((section) => (
          <div key={section.id} className="mb-3">
            {collapsed ? null : (
              <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted">{section.label}</div>
            )}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = isItemActive(item, pathname, search);
                return (
                  <li key={item.id}>
                    <Link
                      to={item.path}
                      data-testid={`nav-${item.id}`}
                      aria-current={active ? 'page' : undefined}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                        active ? 'bg-accent-soft font-medium text-accent-soft-foreground' : 'hover:bg-default'
                      }`}
                    >
                      <item.icon className="size-5 shrink-0" />
                      {collapsed ? null : <span className="truncate">{item.label}</span>}
                      {!collapsed && item.badge ? (
                        <span className="ml-auto rounded-full bg-warning/20 px-1.5 text-xs">{item.badge}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
