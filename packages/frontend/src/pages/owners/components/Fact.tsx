import type { ReactNode } from 'react';
import { Money } from '../../../components/Money';

/** One labelled money field of a card (`data-testid="<testId>"` around a `Money`). */
export function Fact(props: { testId: string; label: string; value?: string | null; children?: ReactNode; strong?: boolean }) {
  return (
    <div data-testid={props.testId} className="flex items-baseline justify-between gap-4 py-0.5">
      <span className={props.strong ? 'font-medium' : 'text-muted'}>{props.label}</span>
      <span className={props.strong ? 'font-semibold' : ''}>{props.children ?? <Money value={props.value} />}</span>
    </div>
  );
}

/** A titled block of a card. */
export function Section(props: { title: string; testId?: string; children: ReactNode; toolbar?: ReactNode }) {
  return (
    <section data-testid={props.testId} className="flex flex-col gap-2 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{props.title}</h2>
        {props.toolbar}
      </div>
      {props.children}
    </section>
  );
}

/** A plain small table (short lists of a card; long lists use DataGrid). */
export function SimpleTable(props: { head: string[]; children: ReactNode; testId?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid={props.testId}>
        <thead className="text-left text-xs text-muted">
          <tr>
            {props.head.map((h) => (
              <th key={h} className="px-2 py-1 font-medium">
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

export function Td(props: { children?: ReactNode; col?: string }) {
  return (
    <td className="border-t border-border px-2 py-1 align-top" data-col={props.col}>
      {props.children}
    </td>
  );
}
