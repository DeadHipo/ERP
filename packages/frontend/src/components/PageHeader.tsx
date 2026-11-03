import type { ReactNode } from 'react';

/** Page title, its one-sentence subtitle (the operator question it answers, 17 §3) and a toolbar slot. */
export function PageHeader(props: { title: string; subtitle?: string; toolbar?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">{props.title}</h1>
        {props.subtitle ? <p className="text-sm text-muted">{props.subtitle}</p> : null}
      </div>
      {props.toolbar ? <div className="flex flex-wrap items-center gap-2">{props.toolbar}</div> : null}
    </div>
  );
}
