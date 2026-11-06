import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { pubV2LinkSchema } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { publishingV2Queries } from '../../../api/queries/publishing';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { Money } from '../../../components/Money';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { fmt, ru } from '../../../i18n/ru';
import { useLabel } from '../../../lib/label';
import { compareDecimal } from '../../../lib/money';

const t = ru.reference.publishingV2;
type Row = z.output<typeof pubV2LinkSchema>;

const linkAction = (name: string) => ({
  invalidate: 'all' as const,
  success: (r: { ownerName: string }) => fmt(t.linked, { name, owner: r.ownerName }),
});

function ChooseOwnerDialog(props: { row: Row; onClose: () => void }) {
  const [owner, setOwner] = useState<string | null>(props.row.link?.ownerId ?? props.row.recommendation?.ownerId ?? null);
  const run = useAction((ownerId: string) => api.publishingV2.link({ songwriterId: props.row.songwriterId, ownerId }), linkAction(props.row.name));
  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => (open ? null : props.onClose())}
      title={t.chooseTitle}
      footer={
        <ActionButton
          name="link-submit"
          op="POST /publishing-v2/links"
          isPending={run.isPending}
          isDisabled={owner === null}
          reason={t.chooseOwner}
          onPress={() => {
            if (owner) run.mutate(owner, { onSuccess: props.onClose });
          }}
        >
          {t.confirm}
        </ActionButton>
      }
    >
      <div className="text-sm">
        {t.cols.name}: <b>{props.row.name}</b>
      </div>
      <EntityPicker name="link-owner" label={t.chooseOwner} kind="owners" value={owner} onChange={(id) => setOwner(id)} />
    </FormDialog>
  );
}

function RowActions(props: { row: Row; onChoose: (row: Row) => void }) {
  const { row } = props;
  const hint = row.recommendation;
  const run = useAction((ownerId: string) => api.publishingV2.link({ songwriterId: row.songwriterId, ownerId }), linkAction(row.name));
  return (
    <div className="flex gap-2">
      {hint && !row.link ? (
        <ActionButton name="confirm-link" op="POST /publishing-v2/links" isPending={run.isPending} onPress={() => run.mutate(hint.ownerId)}>
          {t.confirm}
        </ActionButton>
      ) : null}
      <ActionButton name="choose-owner" op="POST /publishing-v2/links" variant="secondary" onPress={() => props.onChoose(row)}>
        {row.link ? t.change : hint ? t.other : t.choose}
      </ActionButton>
    </div>
  );
}

/** The tab «Связи» (D-183): a suggestion decides nothing; a link is written only by the operator. */
export function LinksTab() {
  const { labelId } = useLabel();
  const query = useQuery(publishingV2Queries.links(labelId));
  const [choosing, setChoosing] = useState<Row | null>(null);
  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        colId: 'name',
        headerName: t.cols.name,
        minWidth: 260,
        valueGetter: (p) => p.data?.name,
        cellRenderer: (p: { data?: Row }) =>
          p.data ? (
            <Link className="text-accent hover:underline" to={`/publishing-v2/${p.data.songwriterId}`}>
              {p.data.name}
            </Link>
          ) : null,
      },
      {
        colId: 'payable',
        headerName: t.cols.payable,
        valueGetter: (p) => p.data?.payable,
        comparator: compareDecimal,
        cellRenderer: (p: { data?: Row }) => (p.data ? <Money value={p.data.payable} /> : null),
      },
      {
        colId: 'link',
        headerName: t.cols.owner,
        minWidth: 220,
        valueGetter: (p) => p.data?.link?.ownerName ?? '',
        cellRenderer: (p: { data?: Row }) =>
          p.data?.link ? (
            <Link className="text-accent hover:underline" to={`/owners/${p.data.link.ownerId}`} title={fmt(t.decided, { by: p.data.link.decidedBy })}>
              {p.data.link.ownerName}
            </Link>
          ) : (
            <span className="text-muted">{t.notLinked}</span>
          ),
      },
      {
        colId: 'recommendation',
        headerName: t.cols.recommendation,
        minWidth: 280,
        valueGetter: (p) => p.data?.recommendation?.ownerName ?? '',
        cellRenderer: (p: { data?: Row }) => {
          const hint = p.data?.recommendation;
          if (!hint) return <span className="text-muted">{t.noRecommendation}</span>;
          return `${hint.ownerName} · ${t.reason[hint.reason]}`;
        },
      },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        minWidth: 260,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: Row }) => (p.data ? <RowActions row={p.data} onChoose={setChoosing} /> : null),
      },
    ],
    [],
  );
  return (
    <div data-testid="links-tab" className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t.linksHint}</p>
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.noSongwriters}>
        {(rows) => <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.songwriterId} rowTestId={(r) => `link-${r.songwriterId}`} />}
      </QueryView>
      {choosing ? <ChooseOwnerDialog row={choosing} onClose={() => setChoosing(null)} /> : null}
    </div>
  );
}
