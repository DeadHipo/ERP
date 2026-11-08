import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { OwnerCuts } from '@erp/shared/api-responses';
import { ownerQueries } from '../../api/queries/owners';
import { useOwnLabels } from '../../components/LabelSwitch';
import { Money } from '../../components/Money';
import { QueryView } from '../../components/PageState';
import { statusLabel } from '../../components/StatusChip';
import { ru } from '../../i18n/ru';
import { centsToText } from './components/cents';

const t = ru.cuts;
type Label = OwnerCuts['labels'][number];
type Position = Label['after']['positions'][number];
type Movement = Label['after']['movement'];
const MOVES = ['earned', 'paid', 'adsCharged', 'other', 'payable'] as const;

/**
 * P10, the tab «Срезы» (D-200): one `GET /owners/:id/cuts` (a money key; under a label its book alone). Per label, per
 * cut by date: the owner's positions at the cut, the operations attributed to it, the movement since the previous
 * cut; last «после последнего среза».
 */
export function OwnerCutsTab(props: { ownerId: string; labelId: string }) {
  const query = useQuery(ownerQueries.cuts(props.ownerId, props.labelId));
  const own = useOwnLabels();
  return (
    <QueryView query={query} money>
      {(data) =>
        data.labels.length === 0 ? (
          <p className="text-sm text-muted" data-testid="owner-cuts-none">
            {t.tabEmpty}
          </p>
        ) : (
          <div className="flex flex-col gap-6" data-testid="owner-cuts">
            {data.labels.map((l) => (
              <section key={l.labelId} className="flex flex-col gap-3" data-testid={`owner-cuts-${l.labelId}`}>
                <h3 className="font-semibold">{own.find((x) => x.id === l.labelId)?.name ?? l.labelId}</h3>
                {l.cuts.map((c, i) => (
                  <div key={c.cut.id} className="rounded-lg border border-border p-3" data-testid={`owner-cut-${c.cut.id}`} data-unsettled={c.unsettled}>
                    <Link to={`/operations/cuts/${encodeURIComponent(c.cut.id)}`} className="font-medium text-accent underline" data-testid={`owner-cut-link-${c.cut.id}`}>
                      {c.cut.name} · {c.cut.cutDate}
                    </Link>
                    <Positions testId={`owner-cut-positions-${c.cut.id}`} rows={c.positions} />
                    <div className="mt-2 text-sm" data-testid={`owner-cut-operations-${c.cut.id}`}>
                      <span className="text-xs text-muted">{t.operations}: </span>
                      {c.operations.length === 0
                        ? t.noOperations
                        : c.operations.map((o) => (
                            <span key={o.id} className="mr-3" data-testid={`owner-cut-op-${o.id}`}>
                              {o.date} · {statusLabel('operationKind', o.kind)} · <Money value={centsToText(o.amountCents)} />
                            </span>
                          ))}
                    </div>
                    <Moves testId={`owner-cut-movement-${c.cut.id}`} title={i === 0 ? t.movementFirst : t.movement} m={c.movement} />
                  </div>
                ))}
                <div className="rounded-lg border border-dashed border-border p-3" data-testid={`owner-cuts-after-${l.labelId}`}>
                  <div className="font-medium">{t.after}</div>
                  <Positions testId={`owner-cuts-after-positions-${l.labelId}`} rows={l.after.positions} />
                  <Moves testId={`owner-cuts-after-movement-${l.labelId}`} title={t.movement} m={l.after.movement} />
                </div>
              </section>
            ))}
          </div>
        )
      }
    </QueryView>
  );
}

function Positions(props: { testId: string; rows: Position[] }) {
  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm" data-testid={props.testId}>
      {props.rows.map((p) => (
        <li key={p.artistId ?? 'own'} data-testid={`${props.testId}-${p.artistId ?? 'own'}`} data-value={p.balance} data-zero={String(p.settled)}>
          <span className={p.settled ? 'text-success' : ''}>{p.pseudonym ?? t.ownPosition}</span>: <Money value={p.balance} />
        </li>
      ))}
    </ul>
  );
}

function Moves(props: { testId: string; title: string; m: Movement }) {
  return (
    <dl className="mt-2 flex flex-wrap gap-3 text-xs" data-testid={props.testId}>
      <dt className="text-muted">{props.title}:</dt>
      {MOVES.map((k) => (
        <dd key={k} data-col={k} data-value={props.m[k]}>
          {t.movementCols[k]} <Money value={props.m[k]} />
        </dd>
      ))}
    </dl>
  );
}
