import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { Cut, CutState } from '@erp/shared/api-responses';
import { KIND_DOCUMENT_KINDS } from '@erp/shared/operation-kinds';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ownerQueries } from '../../../api/queries/owners';
import { settlementQueries } from '../../../api/queries/settlements';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { FormDialog } from '../../../components/FormDialog';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView, StaleBadge } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { formatMoney } from '../../../lib/money';
import { fmt, ru } from '../../../i18n/ru';
import { useUrlParam } from '../../catalog/components/url';
import { DocumentStep, type ReadyDocument } from '../../work/actions/DocumentStep';
import { centsToText } from '../../owners/components/cents';

const t = ru.cuts;
type Item = CutState['items'][number];
const keyOf = (r: Item) => `${r.ownerId}-${r.artistId ?? 'own'}`;
/** `MAX_IDS_PER_REQUEST` of the API: the most owner ids one `GET /settlements/cuts/:id/state?ids=` takes. */
const IDS_PER_REQUEST = 200;

/** A row of P35: one owner of the book; its positions at the cut once asked (D-206). */
interface OwnerRow {
  ownerId: string;
  ownerName: string;
  positions?: Item[];
  /** The count of positions not at zero (the backend's `settled`). */
  open?: number;
}

/** The owner rows of a full state (every owner with a position), the settled owners only with «show all». */
function rowsOfState(items: Item[]): OwnerRow[] {
  const by = new Map<string, OwnerRow>();
  for (const i of items) {
    const r = by.get(i.ownerId) ?? { ownerId: i.ownerId, ownerName: i.ownerName, positions: [] };
    r.positions?.push(i);
    by.set(i.ownerId, r);
  }
  return [...by.values()];
}

/**
 * P35 «Срез» `/operations/cuts/:id` (D-198…D-200, D-206): the positions of the book at the cut, a row per owner, as P9
 * does (D-163): the owners of the book from `GET /owners?label=` (no money, paged), the positions of the rows on the
 * screen from `GET /settlements/cuts/:id/state?ids=` (one calculation of their reach); «Посчитать все» is one full
 * `GET /settlements/cuts/:id/state` with the totals and the filter «не в нуле». Each position not at zero has
 * «Перенести» (the transfer of D-199). A payout or an adjustment on the cut is made on P20 with «Отнести к срезу».
 */
export function CutPage() {
  const { id = '' } = useParams();
  const [allParam, setAll] = useUrlParam('all');
  const full = allParam === '1';
  const [showAll, setShowAll] = useState(false);
  const cuts = useQuery(settlementQueries.cuts());
  const cut = cuts.data?.items.find((c) => c.id === id);
  const state = useQuery({ ...settlementQueries.cutState(id, true), enabled: full });
  const list = useQuery({ ...ownerQueries.list(cut?.labelId ?? ''), enabled: !full && cut !== undefined });
  const [moving, setMoving] = useState<Item | null>(null);

  // the visible rows (a page of the grid), asked after a short pause, in chunks of 200 (the API's cap)
  const [visible, setVisible] = useState<readonly string[]>([]);
  const [asked, setAsked] = useState<readonly string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setAsked(visible), 150);
    return () => clearTimeout(timer);
  }, [visible]);
  const chunks = useMemo(() => {
    const out: string[][] = [];
    for (let i = 0; i < asked.length; i += IDS_PER_REQUEST) out.push(asked.slice(i, i + IDS_PER_REQUEST));
    return out;
  }, [asked]);
  const pageMoney = useQueries({
    queries: chunks.map((ids) => ({ ...settlementQueries.cutStateOf(id, ids), enabled: !full })),
    combine: (results) => ({
      states: results.flatMap((r, n) => (r.data ? [{ ids: chunks[n] ?? [], data: r.data }] : [])),
      updatedAt: results.map((r) => r.dataUpdatedAt).join(','),
      isFetching: results.some((r) => r.isFetching),
    }),
  });
  const moneyRef = useRef(new Map<string, Pick<OwnerRow, 'positions' | 'open'>>());
  const [moneyVersion, setMoneyVersion] = useState(0);
  useEffect(() => {
    if (pageMoney.states.length === 0) return;
    for (const { ids, data } of pageMoney.states) {
      const rows = new Map(rowsOfState(data.items).map((r) => [r.ownerId, r.positions ?? []]));
      for (const ownerId of ids) moneyRef.current.set(ownerId, money(rows.get(ownerId) ?? []));
    }
    setMoneyVersion((v) => v + 1);
    // updatedAt: the chunks answered (the states array is rebuilt on every render)
  }, [pageMoney.updatedAt]);
  // another cut: forget the positions seen under the previous one (the route keeps the component)
  useEffect(() => {
    moneyRef.current.clear();
    setMoneyVersion((v) => v + 1);
    setShowAll(false);
  }, [id]);
  const onVisibleRowsChanged = useCallback((rows: OwnerRow[]) => {
    const next = rows.map((r) => r.ownerId).sort();
    setVisible((prev) => (prev.join(',') === next.join(',') ? prev : next));
  }, []);

  const pagedRows = useMemo(
    () =>
      (list.data ?? []).map((o): OwnerRow => ({
        ownerId: o.id,
        ownerName: o.name,
        ...moneyRef.current.get(o.id),
      })),
    // moneyVersion: the positions of a page arrived (the map is a ref)
    [list.data, moneyVersion],
  );
  const fullRows = useMemo(() => {
    if (!state.data) return [];
    const rows = rowsOfState(state.data.items).map((r) => ({ ...r, ...money(r.positions ?? []) }));
    return showAll ? rows : rows.filter((r) => (r.open ?? 0) > 0);
  }, [state.data, showAll]);
  const columns = useMemo(() => cutColumns(full, (item) => setMoving(item)), [full]);

  const grid = (rows: OwnerRow[]) => (
    <DataGrid
      key={full ? 'cut-all' : 'cut-paged'}
      rowData={rows}
      columnDefs={columns}
      getRowId={(r) => r.ownerId}
      rowTestId={(r) => `cut-owner-${r.ownerId}`}
      gridStateKey="grid"
      onVisibleRowsChanged={full ? undefined : onVisibleRowsChanged}
    />
  );
  return (
    <QueryView query={cuts}>
      {() =>
        !cut ? (
          <p className="text-sm text-muted" data-testid="cut-not-found">
            {t.notFound}
          </p>
        ) : (
          <div
            data-testid="cut-page"
            data-cut-id={cut.id}
            data-label-id={cut.labelId}
            data-mode={full ? 'all' : 'paged'}
          >
            <PageHeader title={fmt(t.stateTitle, { name: cut.name })} subtitle={t.hint} />
            <p className="mb-2 text-sm" data-testid="cut-bounds">
              {fmt(t.bounds, {
                date: cut.cutDate,
                master: cut.masterTo,
                pub: cut.publishingTo,
                ads: cut.adsTo,
              })}
            </p>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-muted">
              {full ? (
                <>
                  <span data-testid="cut-all-money">{t.allMoney}</span>
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    data-testid="action-cut-visible-only"
                    onClick={() => setAll('')}
                  >
                    {t.visibleOnly}
                  </button>
                </>
              ) : (
                <>
                  <span data-testid="cut-visible-money">{t.visibleMoney}</span>
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    data-testid="action-cut-compute-all"
                    onClick={() => setAll('1')}
                  >
                    {t.computeAll}
                  </button>
                  <StaleBadge show={pageMoney.isFetching} />
                </>
              )}
            </div>
            {full ? (
              <QueryView query={state} money>
                {(data) => (
                  <>
                    <Totals data={data} />
                    <label className="mb-2 flex items-center gap-1 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={showAll}
                        onChange={(e) => setShowAll(e.target.checked)}
                        data-testid="field-cut-show-all"
                      />
                      {t.showAll}
                    </label>
                    {fullRows.length === 0 ? (
                      <p className="text-sm text-muted" data-testid="cut-settled">
                        {t.settled}
                      </p>
                    ) : (
                      grid(fullRows)
                    )}
                  </>
                )}
              </QueryView>
            ) : (
              <QueryView query={list} isEmpty={(d) => d.length === 0} emptyMessage={t.noPositions}>
                {() => grid(pagedRows)}
              </QueryView>
            )}
            {moving ? <TransferDialog item={moving} cut={cut} onClose={() => setMoving(null)} /> : null}
          </div>
        )
      }
    </QueryView>
  );
}

/** The money of one owner's row: its positions and the count not at zero (the backend's `settled`; R1: no sums here). */
function money(all: Item[]): Pick<OwnerRow, 'positions' | 'open'> {
  // the owner's own position (no pseudonym) is listed only when it is not at zero: most owners have none
  const positions = all.filter((p) => p.artistId !== null || !p.settled);
  return { positions, open: positions.filter((p) => !p.settled).length };
}

function Totals(props: { data: CutState }) {
  return (
    <dl className="mb-3 flex flex-wrap gap-2 text-sm" data-testid="cut-totals">
      <div className="rounded-lg border border-border px-3 py-2" data-col="total">
        <dt className="text-xs text-muted">{t.total}</dt>
        <dd className="font-semibold" data-value={props.data.total}>
          <Money value={props.data.total} />
        </dd>
      </div>
      <div className="rounded-lg border border-border px-3 py-2" data-col="unsettled">
        <dt className="text-xs text-muted">{t.unsettled}</dt>
        <dd className="font-semibold" data-value={props.data.unsettled}>
          {props.data.unsettled}
        </dd>
      </div>
    </dl>
  );
}

type P = { data?: OwnerRow };

/** The columns of P35: the owner, its positions (each with «Перенести» when not at zero), the count not at zero. */
function cutColumns(full: boolean, onTransfer: (item: Item) => void): ColDef<OwnerRow>[] {
  return [
    {
      colId: 'owner',
      headerName: t.cols.owner,
      minWidth: 200,
      valueGetter: (p) => p.data?.ownerName,
      cellRenderer: (p: P) =>
        p.data ? <EntityLink kind="owner" id={p.data.ownerId} label={p.data.ownerName} /> : null,
    },
    {
      colId: 'positions',
      headerName: t.cols2.positions,
      flex: 2,
      minWidth: 320,
      sortable: false,
      filter: false,
      autoHeight: true,
      cellRenderer: (p: P) =>
        !p.data ? null : p.data.positions === undefined ? (
          <span className="text-muted" data-testid="money-pending">
            {ru.money.owners.moneyPending}
          </span>
        ) : p.data.positions.length === 0 ? (
          <span className="text-muted">{t.noPositions}</span>
        ) : (
          <ul className="flex flex-col gap-1 py-1">
            {p.data.positions.map((i) => (
              <li key={keyOf(i)} className="flex items-center gap-2" data-testid={`cut-position-${keyOf(i)}`}>
                <span className="min-w-40">
                  {i.artistId ? (
                    <EntityLink kind="artist" id={i.artistId} label={i.pseudonym ?? ''} />
                  ) : (
                    <span className="text-muted">{t.ownPosition}</span>
                  )}
                </span>
                <span data-col="balance" data-value={i.balance} className={i.settled ? 'text-success' : ''}>
                  <Money value={i.balance} />
                </span>
                {!i.settled ? (
                  <ActionButton
                    name={`cut-transfer-${keyOf(i)}`}
                    op="POST /settlements/cuts/:id/transfer"
                    compact
                    variant="secondary"
                    onPress={() => onTransfer(i)}
                  >
                    {t.transfer}
                  </ActionButton>
                ) : null}
              </li>
            ))}
          </ul>
        ),
    },
    {
      colId: 'open',
      headerName: t.cols2.open,
      sortable: full,
      filter: false,
      maxWidth: 140,
      valueGetter: (p) => p.data?.open,
      cellRenderer: (p: P) =>
        p.data?.open === undefined ? null : <span data-col="open">{p.data.open}</span>,
    },
  ];
}

/** «Перенести» (D-199): the backend moves the whole position at the cut (in cents), with an adjustment basis document of the owner. */
function TransferDialog(props: { item: Item; cut: Cut; onClose: () => void }) {
  const r = props.item;
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const run = useAction(
    () =>
      api.settlements.transferAtCut(props.cut.id, {
        ownerId: r.ownerId,
        artistId: r.artistId,
        documentId: doc?.id ?? '',
      }),
    {
      invalidate: 'all',
      success: (res) => fmt(t.transferred, { amount: formatMoney(centsToText(res.atCut.amountCents)) }),
    },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.transferTitle}
      subtitle={t.transferSubtitle}
      footer={
        <ActionButton
          name="cut-transfer-submit"
          op="POST /settlements/cuts/:id/transfer"
          isDisabled={doc === null}
          reason={ru.actions.hints.pickFirst}
          isPending={run.isPending}
          onPress={() => run.mutate(undefined, { onSuccess: () => props.onClose() })}
        >
          {t.transferSubmit}
        </ActionButton>
      }
    >
      <p className="text-sm" data-testid="cut-transfer-line">
        {fmt(t.transferLine, {
          owner: r.ownerName,
          pseudonym: r.pseudonym ?? t.ownPosition,
          amount: formatMoney(r.balance),
        })}
      </p>
      <div data-testid="field-cut-transfer-document">
        <DocumentStep
          kinds={KIND_DOCUMENT_KINDS.adjustment}
          ownerId={r.ownerId}
          labelId={props.cut.labelId}
          defaultTitle={`${t.transferDocTitle} ${r.ownerName}`}
          ready={doc}
          onReady={setDoc}
        />
      </div>
    </FormDialog>
  );
}
