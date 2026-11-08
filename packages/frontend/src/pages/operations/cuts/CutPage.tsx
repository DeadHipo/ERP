import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { CutState } from '@erp/shared/api-responses';
import { KIND_DOCUMENT_KINDS } from '@erp/shared/operation-kinds';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { settlementQueries } from '../../../api/queries/settlements';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { FormDialog } from '../../../components/FormDialog';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { compareDecimal, formatMoney } from '../../../lib/money';
import { fmt, ru } from '../../../i18n/ru';
import { DocumentStep, type ReadyDocument } from '../../work/actions/DocumentStep';
import { centsToText } from '../../owners/components/cents';

const t = ru.cuts;
type Item = CutState['items'][number];
const keyOf = (r: Item) => `${r.ownerId}-${r.artistId ?? 'own'}`;

/**
 * P35 «Срез» `/operations/cuts/:id` (D-198…D-200): the positions of the book at the cut (`GET /settlements/cuts/:id/state`,
 * by default only those not at zero), each with the link to its owner's tab «Срезы» and «Перенести» (the transfer
 * of D-199: two adjustments with one basis document). A payout or an adjustment on the cut is made on P20 with the
 * field «Отнести к срезу».
 */
export function CutPage() {
  const { id = '' } = useParams();
  const [all, setAll] = useState(false);
  const state = useQuery(settlementQueries.cutState(id, all));
  const [moving, setMoving] = useState<{ item: Item; labelId: string; cutId: string } | null>(null);
  const columns = useMemo<ColDef<Item>[]>(
    () => [
      {
        colId: 'owner',
        headerName: t.cols.owner,
        valueGetter: (p) => p.data?.ownerName,
        cellRenderer: (p: { data?: Item }) => (p.data ? <EntityLink kind="owner" id={p.data.ownerId} label={p.data.ownerName} /> : null),
      },
      {
        colId: 'pseudonym',
        headerName: t.cols.pseudonym,
        valueGetter: (p) => p.data?.pseudonym ?? t.ownPosition,
        cellRenderer: (p: { data?: Item }) =>
          p.data ? p.data.artistId ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym ?? ''} /> : <span className="text-muted">{t.ownPosition}</span> : null,
      },
      {
        colId: 'balance',
        headerName: t.cols.balance,
        comparator: compareDecimal,
        valueGetter: (p) => p.data?.balance,
        cellRenderer: (p: { data?: Item }) => (p.data ? <span data-col="balance" data-value={p.data.balance}><Money value={p.data.balance} /></span> : null),
      },
    ],
    [],
  );
  return (
    <QueryView query={state} money>
      {(data) => (
        <div data-testid="cut-page" data-cut-id={data.cut.id} data-label-id={data.cut.labelId}>
          <PageHeader title={fmt(t.stateTitle, { name: data.cut.name })} subtitle={t.hint} />
          <p className="mb-2 text-sm" data-testid="cut-bounds">
            {fmt(t.bounds, { date: data.cut.cutDate, master: data.cut.masterTo, pub: data.cut.publishingTo, ads: data.cut.adsTo })}
          </p>
          <dl className="mb-3 flex flex-wrap gap-2 text-sm" data-testid="cut-totals">
            <div className="rounded-lg border border-border px-3 py-2" data-col="total">
              <dt className="text-xs text-muted">{t.total}</dt>
              <dd className="font-semibold" data-value={data.total}>
                <Money value={data.total} />
              </dd>
            </div>
            <div className="rounded-lg border border-border px-3 py-2" data-col="unsettled">
              <dt className="text-xs text-muted">{t.unsettled}</dt>
              <dd className="font-semibold" data-value={data.unsettled}>
                {data.unsettled}
              </dd>
            </div>
          </dl>
          <label className="mb-2 flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-testid="field-cut-show-all" />
            {t.showAll}
          </label>
          {data.items.length === 0 ? (
            <p className="text-sm text-muted" data-testid="cut-settled">
              {t.settled}
            </p>
          ) : (
            <DataGrid
              rowData={data.items}
              columnDefs={[
                ...columns,
                {
                  colId: 'actions',
                  headerName: t.cols.actions,
                  sortable: false,
                  filter: false,
                  cellRenderer: (p: { data?: Item }) =>
                    p.data && !p.data.settled ? (
                      <ActionButton
                        name={`cut-transfer-${keyOf(p.data)}`}
                        op="POST /settlements/cuts/:id/transfer"
                        compact
                        variant="secondary"
                        onPress={() => p.data && setMoving({ item: p.data, labelId: data.cut.labelId, cutId: data.cut.id })}
                      >
                        {t.transfer}
                      </ActionButton>
                    ) : null,
                },
              ]}
              getRowId={keyOf}
              rowTestId={(r) => `cut-position-${keyOf(r)}`}
              pageSize={500}
              autoHeight
            />
          )}
          {moving ? <TransferDialog {...moving} onClose={() => setMoving(null)} /> : null}
        </div>
      )}
    </QueryView>
  );
}

/** «Перенести» (D-199): the backend moves the whole position at the cut (in cents), with an adjustment basis document of the owner. */
function TransferDialog(props: { item: Item; labelId: string; cutId: string; onClose: () => void }) {
  const r = props.item;
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const run = useAction(
    () => api.settlements.transferAtCut(props.cutId, { ownerId: r.ownerId, artistId: r.artistId, documentId: doc?.id ?? '' }),
    { invalidate: 'all', success: (res) => fmt(t.transferred, { amount: formatMoney(centsToText(res.atCut.amountCents)) }) },
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
        {fmt(t.transferLine, { owner: r.ownerName, pseudonym: r.pseudonym ?? t.ownPosition, amount: formatMoney(r.balance) })}
      </p>
      <div data-testid="field-cut-transfer-document">
        <DocumentStep
          kinds={KIND_DOCUMENT_KINDS.adjustment}
          ownerId={r.ownerId}
          labelId={props.labelId}
          defaultTitle={`${t.transferDocTitle} ${r.ownerName}`}
          ready={doc}
          onReady={setDoc}
        />
      </div>
    </FormDialog>
  );
}
