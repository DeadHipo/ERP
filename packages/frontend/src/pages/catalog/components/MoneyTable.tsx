import type { ReactNode } from 'react';

/** A plain table of a few money rows (no paging needed): header cells and rows rendered by the page. */
export function SimpleTable(props: { testId?: string; headers: readonly string[]; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-border ${props.className ?? ''}`}>
      <table className="w-full text-sm" data-testid={props.testId}>
        <thead className="bg-default/50 text-left text-xs text-muted">
          <tr>
            {props.headers.map((h, i) => (
              <th key={`${h}-${i}`} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

/** A table cell; `col` becomes `data-col` (specs read `[data-col="B"] [data-testid="money"]`). */
export function Td(props: { col?: string; children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td className={`px-3 py-2 align-top ${props.className ?? ''}`} data-col={props.col} colSpan={props.colSpan}>
      {props.children}
    </td>
  );
}
