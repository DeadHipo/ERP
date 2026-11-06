import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Onboarding } from '@erp/shared/api-responses';
import { ActionButton } from '../../../components/ActionButton';
import { readStorage, writeStorage } from '../../../lib/storage';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.onboarding;
type State = Onboarding['steps'][number]['state'];

const MARK: Record<State, { icon: string; className: string }> = {
  done: { icon: '✓', className: 'text-success' },
  todo: { icon: '○', className: 'text-warning' },
  info: { icon: 'i', className: 'text-muted' },
};

/**
 * One step of a checklist (D-172): its state as the backend decided it (R4), its counters as `data-col`, the link of
 * the backend to the page that fixes or shows it, and what more the step carries (`children`).
 */
export function StepRow(props: {
  testId: string;
  linkTestId: string;
  title: string;
  state: State;
  counts: Record<string, number>;
  link: string;
  children?: ReactNode;
}) {
  const mark = MARK[props.state];
  return (
    <li data-testid={props.testId} data-state={props.state} className="flex flex-col gap-1 border-t border-border py-2 first:border-t-0">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={`w-4 text-center font-semibold ${mark.className}`} title={t[props.state]}>
          {mark.icon}
        </span>
        <span className="font-medium">{props.title}</span>
        <span className="flex flex-wrap gap-3 text-xs text-muted">
          {Object.entries(props.counts).map(([name, n]) => (
            <span key={name} data-col={name} data-value={n}>
              {t.counts[name] ?? name}: <b className="text-foreground">{n}</b>
            </span>
          ))}
        </span>
        <Link to={props.link} className="ml-auto text-xs text-accent hover:underline" data-testid={props.linkTestId}>
          {t.open}
        </Link>
      </div>
      {props.children}
    </li>
  );
}

/** A checklist card with its title, the done count and «Свернуть» remembered per key (`localStorage erp.onboarding.<key>`). */
export function ChecklistCard(props: {
  testId: string;
  storageKey: string;
  title: string;
  done: number;
  total: number;
  attrs?: Record<string, string>;
  children: ReactNode;
}) {
  const key = `erp.onboarding.${props.storageKey}`;
  const [collapsed, setCollapsed] = useState(() => readStorage('local', key) === '1');
  const toggle = () => {
    writeStorage('local', key, collapsed ? '0' : '1');
    setCollapsed(!collapsed);
  };
  return (
    <section className="mb-4 rounded-xl border border-border p-3" data-testid={props.testId} data-collapsed={collapsed ? 'true' : 'false'} {...props.attrs}>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">{props.title}</h2>
        <span className="text-xs text-muted">{fmt(t.progress, { done: props.done, total: props.total })}</span>
        <span className="ml-auto">
          <ActionButton name="onboarding-collapse" write={false} variant="tertiary" onPress={toggle}>
            {collapsed ? t.expand : t.collapse}
          </ActionButton>
        </span>
      </div>
      {collapsed ? null : <ul className="mt-2 flex flex-col">{props.children}</ul>}
    </section>
  );
}
