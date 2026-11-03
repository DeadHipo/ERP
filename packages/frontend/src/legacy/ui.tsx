import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { REASON_LABELS } from '@erp/shared/reasons';
import { ApiError } from './client';

/** Loads data from the API; `reload` re-runs the request. */
export function useApi<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setError(undefined);
    load()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}

/** Runs an action and keeps its error for display (e.g. the duplicate-period error of an upload). */
export function useAction() {
  const [error, setError] = useState<ApiError | Error | undefined>();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e as Error);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run, clear: () => setError(undefined) };
}

/** Money as sent by the API (exact decimal string), shown with 2 decimals; the exact value is in the tooltip. */
export function Money({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined) return <span className="muted">—</span>;
  const n = Number(value);
  const shown = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <span className={`money${n < 0 ? ' negative' : ''}`} title={value}>
      {shown}
    </span>
  );
}

export function ErrorBox({ error }: { error?: Error | string }) {
  if (!error) return null;
  const msg = typeof error === 'string' ? error : error.message;
  const code = error instanceof ApiError ? error.code : undefined;
  return (
    <div className="error" role="alert">
      {code && <strong>{code}: </strong>}
      {msg}
    </div>
  );
}

export function Status({ value }: { value: string }) {
  return <span className={`status status-${value}`}>{value.replace(/_/g, ' ')}</span>;
}

export interface Column<T> {
  title: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({ rows, columns, keyOf, empty = 'Nothing here yet' }: { rows: T[]; columns: Column<T>[]; keyOf: (r: T) => string; empty?: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.title} className={c.className}>
              {c.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={keyOf(r)}>
            {columns.map((c) => (
              <td key={c.title} className={c.className}>
                {c.render(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string | null | undefined; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">
        <Money value={value} />
      </div>
    </div>
  );
}

/** Label of a category C reason; an unknown key (a newer backend) is shown as it is. */
export const reasonLabel = (k: string): string => (REASON_LABELS as Record<string, string>)[k] ?? k.replace(/_/g, ' ');
