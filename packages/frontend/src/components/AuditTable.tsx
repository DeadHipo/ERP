import type { AuditAction } from '@erp/shared/api-responses';
import { formatDateTime } from '../lib/datetime';
import { ru } from '../i18n/ru';

const t = ru.audit;

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** The fields of the write (`summary.body`, D-140: amounts, dates, enums) as `name: value` lines; the ids of `params` are the row's entity. */
function summaryLines(summary: Record<string, unknown>): string[] {
  const body = record(summary.body);
  const top = Object.entries(summary).filter(([k, v]) => k !== 'body' && k !== 'params' && scalar(v));
  return [...Object.entries(body).filter(([, v]) => scalar(v)), ...top].map(
    ([k, v]) => `${(Object.hasOwn(t.fields, k) ? t.fields[k] : undefined) ?? k}: ${String(v)}`,
  );
}

/** The operator's name of a write: «утверждён документ» for `POST /documents/:id/approve`; an unknown route shows as it is. */
export function routeLabel(method: string, route: string): string {
  const key = `${method} ${route}`;
  return (Object.hasOwn(t.routes, key) ? t.routes[key] : undefined) ?? key;
}

/**
 * The history of an entity (`GET /audit?entityId=`) on P6 and P10: when (local `DD.MM.YYYY HH:mm`), who, what was done
 * (the Russian action; the API route template is the tooltip) and its fields. Rows `audit-<id>`, cells
 * `data-col="operator|route"`.
 */
export function AuditTable(props: { items: readonly AuditAction[]; testId?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm" data-testid={props.testId}>
        <thead className="bg-default/50 text-left text-xs text-muted">
          <tr>
            {[t.cols.at, t.cols.operator, t.cols.action, t.cols.summary].map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.items.map((x) => {
            const template = `${x.method} ${x.route}`;
            return (
              <tr key={x.id} data-testid={`audit-${x.id}`} className="border-t border-border align-top">
                <td className="whitespace-nowrap px-3 py-2" title={x.at}>
                  {formatDateTime(x.at)}
                </td>
                <td className="px-3 py-2" data-col="operator">
                  {x.operator}
                </td>
                <td className="px-3 py-2" data-col="route" data-route={template} title={template}>
                  {routeLabel(x.method, x.route)}
                  {/* The template stays in the text for search and the specs, not on screen. */}
                  <span className="sr-only"> {template}</span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {summaryLines(x.summary).map((line) => (
                    <div key={line}>{line}</div>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
