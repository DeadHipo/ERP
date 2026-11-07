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
import { TermDialog } from './TermDialog';

const t = ru.reference.publishingV2;
type Row = z.output<typeof pubV2LinkSchema>;

const linkAction = (name: string) => ({
  invalidate: 'all' as const,
  success: (r: { ownerName: string }) => fmt(t.linked, { name, owner: r.ownerName }),
});

export function ChooseOwnerDialog(props: { row: Row; onClose: () => void }) {
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
      {props.row.songCandidates.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="song-candidates">
          <div className="text-xs text-muted">{fmt(t.songCandidates, { of: props.row.songs })}</div>
          {props.row.songCandidates.map((c) => (
            <label key={c.ownerId} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-default/50">
              <input type="radio" name="song-candidate" data-testid={`candidate-${c.ownerId}`} checked={owner === c.ownerId} onChange={() => setOwner(c.ownerId)} />
              <span>
                {c.ownerName} · {fmt(t.bySongs, { songs: c.songs, of: props.row.songs })}
                {c.hasTerms ? '' : ` · ${t.noTermShort}`}
              </span>
            </label>
          ))}
        </div>
      ) : null}
      <EntityPicker name="link-owner" label={t.chooseOwner} kind="owners" value={owner} onChange={(id) => setOwner(id)} />
    </FormDialog>
  );
}

function RowActions(props: { row: Row; onChoose: (row: Row) => void; onTerm: (row: Row) => void }) {
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
      {row.link ? (
        <ActionButton name="set-term" op="POST /publishing-v2/terms" variant="secondary" onPress={() => props.onTerm(row)}>
          {t.split}
        </ActionButton>
      ) : null}
    </div>
  );
}

/** The tab «Связи» (D-183): a suggestion decides nothing; a link is written only by the operator. */
export function LinksTab() {
  const { labelId } = useLabel();
  const query = useQuery(publishingV2Queries.links(labelId));
  const [choosing, setChoosing] = useState<Row | null>(null);
  const [terming, setTerming] = useState<Row | null>(null);
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
        colId: 'percent',
        headerName: t.cols.percent,
        valueGetter: (p) => {
          const open = p.data?.link?.terms.filter((x) => x.validTo === null) ?? [];
          return open.length > 0 ? open.map((x) => `${x.percent}%`).join(', ') : p.data?.link ? t.noTermShort : '';
        },
      },
      {
        colId: 'recommendation',
        headerName: t.cols.recommendation,
        minWidth: 280,
        valueGetter: (p) => p.data?.recommendation?.ownerName ?? '',
        cellRenderer: (p: { data?: Row }) => {
          const hint = p.data?.recommendation;
          if (!hint) return <span className="text-muted">{t.noRecommendation}</span>;
          const songs = p.data?.songCandidates.find((c) => c.ownerId === hint.ownerId)?.songs;
          const detail = hint.reason === 'songs' && songs !== undefined ? fmt(t.bySongs, { songs, of: p.data?.songs ?? 0 }) : t.reason[hint.reason];
          return `${hint.ownerName} · ${detail}${hint.hasTerms ? '' : ` · ${t.noTermShort}`}`;
        },
      },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        minWidth: 320,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: Row }) => (p.data ? <RowActions row={p.data} onChoose={setChoosing} onTerm={setTerming} /> : null),
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
      {terming?.link ? (
        <TermDialog ownerId={terming.link.ownerId} ownerName={terming.link.ownerName} terms={terming.link.terms} onClose={() => setTerming(null)} />
      ) : null}
    </div>
  );
}
