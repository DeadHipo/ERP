import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { OwnerCuts as OwnerCutsData } from '@erp/shared/api-responses';
import { ownerQueries } from '../../api/queries/owners';
import { useOwnLabels } from '../../components/LabelSwitch';
import { Money } from '../../components/Money';
import { statusLabel } from '../../components/StatusChip';
import { ru } from '../../i18n/ru';
import { centsToText } from './components/cents';
import { Section } from './components/Fact';

const t = ru.cuts;
type Label = OwnerCutsData['labels'][number];
type Position = Label['after']['positions'][number];
const MOVES = ['earned', 'paid', 'adsCharged', 'other', 'payable'] as const;
const keyOf = (p: { artistId: string | null }) => p.artistId ?? 'own';

/**
 * P10, the block «Срезы» on the owner page above the tabs (D-200, D-204): one `GET /owners/:id/cuts` (a money key; under
 * a label its book alone); nothing is shown when the owner has no book with cuts. Per label one table: a row per
 * position (a pseudonym, the owner's own), a column per cut by date and «после последнего среза»; below, the movement
 * since the previous cut and the operations attributed to each cut.
 */
export function OwnerCuts(props: { ownerId: string; labelId: string }) {
  const query = useQuery(ownerQueries.cuts(props.ownerId, props.labelId));
  // an optional block: nothing while it loads or when the owner has no book with cuts, one line when it fails
  if (query.isError && query.data === undefined)
    return (
      <p className="text-sm text-danger" data-testid="owner-cuts-error">
        {t.loadError}
      </p>
    );
  const data = query.data;
  if (data === undefined || data.labels.length === 0) return null;
  return (
    <Section title={t.title} testId="owner-cuts">
      <div className="flex flex-col gap-4">
        {data.labels.map((l) => (
          <LabelCuts key={l.labelId} label={l} showName={data.labels.length > 1 || !props.labelId} />
        ))}
      </div>
    </Section>
  );
}

function LabelCuts(props: { label: Label; showName: boolean }) {
  const l = props.label;
  const own = useOwnLabels();
  // every position seen at a cut or now: the pseudonyms in the order of the answer, the owner's own last
  const rows = new Map<string, Position>();
  for (const p of [...l.after.positions, ...l.cuts.flatMap((c) => c.positions)]) if (!rows.has(keyOf(p))) rows.set(keyOf(p), p);
  const ordered = [...rows.entries()].sort(([a], [b]) => (a === 'own' ? 1 : 0) - (b === 'own' ? 1 : 0));
  const cell = (p: Position | undefined, testId: string) => (
    <td key={testId} className="border-t border-border px-2 py-1 text-right" data-testid={testId} data-value={p?.balance ?? '0'} data-zero={String(p?.settled ?? true)}>
      <span className={p === undefined || p.settled ? 'text-success' : ''}>
        <Money value={p?.balance ?? '0'} />
      </span>
    </td>
  );
  return (
    <div className="flex flex-col gap-1" data-testid={`owner-cuts-${l.labelId}`}>
      {props.showName ? <h3 className="text-sm font-semibold">{own.find((x) => x.id === l.labelId)?.name ?? l.labelId}</h3> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-2 py-1 text-left font-medium">{t.cols.pseudonym}</th>
              {l.cuts.map((c) => (
                <th key={c.cut.id} className="px-2 py-1 text-right font-medium" data-testid={`owner-cut-${c.cut.id}`} data-unsettled={c.unsettled}>
                  <Link to={`/operations/cuts/${encodeURIComponent(c.cut.id)}`} className="text-accent underline" data-testid={`owner-cut-link-${c.cut.id}`}>
                    {c.cut.name} · {c.cut.cutDate}
                  </Link>
                </th>
              ))}
              <th className="px-2 py-1 text-right font-medium" data-testid={`owner-cuts-after-${l.labelId}`}>
                {t.after}
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(([key, p]) => (
              <tr key={key}>
                <td className="border-t border-border px-2 py-1">{p.pseudonym ?? t.ownPosition}</td>
                {l.cuts.map((c) => cell(c.positions.find((x) => keyOf(x) === key), `owner-cut-positions-${c.cut.id}-${key}`))}
                {cell(l.after.positions.find((x) => keyOf(x) === key), `owner-cuts-after-positions-${l.labelId}-${key}`)}
              </tr>
            ))}
            {MOVES.map((k, i) => (
              <tr key={k} className="text-xs text-muted">
                <td className={`px-2 py-0.5 ${i === 0 ? 'border-t-2 border-border' : ''}`} title={t.movementHint}>
                  {i === 0 ? `${t.movement}: ` : ''}
                  {t.movementCols[k]}
                </td>
                {[...l.cuts.map((c) => ({ id: `owner-cut-movement-${c.cut.id}`, m: c.movement })), { id: `owner-cuts-after-movement-${l.labelId}`, m: l.after.movement }].map((x) => (
                  <td key={x.id} className={`px-2 py-0.5 text-right ${i === 0 ? 'border-t-2 border-border' : ''}`} data-testid={`${x.id}-${k}`} data-col={k} data-value={x.m[k]}>
                    <Money value={x.m[k]} />
                  </td>
                ))}
              </tr>
            ))}
            <tr className="text-xs">
              <td className="border-t border-border px-2 py-1 text-muted">{t.operations}</td>
              {l.cuts.map((c) => (
                <td key={c.cut.id} className="border-t border-border px-2 py-1 text-right" data-testid={`owner-cut-operations-${c.cut.id}`}>
                  {c.operations.length === 0
                    ? t.noOperations
                    : c.operations.map((o) => (
                        <div key={o.id} data-testid={`owner-cut-op-${o.id}`}>
                          {o.date} · {statusLabel('operationKind', o.kind)} · <Money value={centsToText(o.amountCents)} />
                        </div>
                      ))}
                </td>
              ))}
              <td className="border-t border-border px-2 py-1" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
