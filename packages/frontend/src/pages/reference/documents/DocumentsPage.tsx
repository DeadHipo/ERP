import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { documentSchema } from '@erp/shared/api-responses';
import { documentQueries } from '../../../api/queries/documents';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { StatusChip, statusLabel } from '../../../components/StatusChip';
import { DataGrid } from '../../../components/grid/DataGrid';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { useUrlParam } from '../../catalog/components/url';
import { ApproveDocumentDialog } from '../../work/actions/dialogs';
import { OwnerLink, useOwnerNames } from '../shared';
import { AttachDialog, CreateDocumentDialog, KINDS } from './DocumentDialogs';

const t = ru.reference.documents;
type Row = z.output<typeof documentSchema>;
const STATUSES = ['not_attached', 'not_approved', 'approved'] as const;

/** The approve button of a row or card: hidden for `assumption`, disabled without a file. */
export function ApproveControl(props: { doc: Row; onApprove: () => void }) {
  const d = props.doc;
  if (d.kind === 'assumption')
    return (
      <span className="text-xs text-muted" data-testid="assumption-note">
        {t.assumptionNote}
      </span>
    );
  if (d.status === 'approved') return null;
  return (
    <ActionButton name="approve" variant="secondary" isDisabled={d.status === 'not_attached'} reason={t.approveFirstAttach} onPress={props.onApprove}>
      {t.approve}
    </ActionButton>
  );
}

/** P13 «Документы» `/documents?status&kind&q&ownerId`: `GET /documents` with the filters (N12). */
export function DocumentsPage() {
  const [status, setStatus] = useUrlParam('status');
  const [kind, setKind] = useUrlParam('kind');
  const [q, setQ] = useUrlParam('q');
  const [ownerId, setOwnerId] = useUrlParam('ownerId');
  const [dialog, setDialog] = useState<{ kind: 'create' } | { kind: 'attach' | 'approve'; doc: Row } | null>(null);
  const names = useOwnerNames();
  const query = useQuery(
    documentQueries.filtered({
      status: STATUSES.find((s) => s === status),
      kind: KINDS.find((k) => k === kind),
      q: q.trim() || undefined,
      ownerId: ownerId || undefined,
    }),
  );
  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        colId: 'title',
        headerName: t.cols.title,
        minWidth: 200,
        valueGetter: (p) => p.data?.title,
        cellRenderer: (p: { data?: Row }) => (p.data ? <EntityLink kind="document" id={p.data.id} label={p.data.title} /> : null),
      },
      {
        colId: 'kind',
        headerName: t.cols.kind,
        valueGetter: (p) => (p.data ? statusLabel('documentKind', p.data.kind) : ''),
        cellRenderer: (p: { data?: Row }) => (p.data ? <StatusChip kind="documentKind" value={p.data.kind} /> : null),
      },
      {
        colId: 'status',
        headerName: t.cols.status,
        valueGetter: (p) => (p.data ? statusLabel('documentStatus', p.data.status) : ''),
        cellRenderer: (p: { data?: Row }) => (p.data ? <StatusChip kind="documentStatus" value={p.data.status} /> : null),
      },
      {
        colId: 'owner',
        headerName: t.cols.owner,
        valueGetter: (p) => (p.data?.ownerId ? (names.get(p.data.ownerId) ?? p.data.ownerId) : ''),
        cellRenderer: (p: { data?: Row }) => (p.data ? <OwnerLink ownerId={p.data.ownerId} names={names} /> : null),
      },
      { colId: 'approvedAt', headerName: t.cols.approvedAt, valueGetter: (p) => p.data?.approvedAt?.slice(0, 10) ?? '' },
      { colId: 'migration', headerName: t.cols.migration, maxWidth: 130, valueGetter: (p) => (p.data?.migration ? t.migration : '') },
      {
        colId: 'actions',
        headerName: '',
        sortable: false,
        filter: false,
        minWidth: 260,
        cellRenderer: (p: { data?: Row }) =>
          p.data ? (
            <span className="flex items-center gap-2">
              {p.data.status === 'not_attached' ? (
                <ActionButton name="attach" variant="secondary" onPress={() => p.data && setDialog({ kind: 'attach', doc: p.data })}>
                  {t.attach}
                </ActionButton>
              ) : null}
              <ApproveControl doc={p.data} onApprove={() => p.data && setDialog({ kind: 'approve', doc: p.data })} />
            </span>
          ) : null,
      },
    ],
    [names],
  );
  return (
    <div data-testid="documents-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ActionButton name="create-document" onPress={() => setDialog({ kind: 'create' })}>
            {t.create}
          </ActionButton>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-64">
          <TextField name="documents-q" label={t.q} value={q} onChange={setQ} type="search" />
        </div>
        <div className="w-48">
          <SelectField name="documents-status" label={t.status} value={status || 'all'} onChange={(v) => setStatus(v === 'all' ? '' : v)} options={[{ id: 'all', label: ru.reference.common.all }, ...STATUSES.map((s) => ({ id: s, label: statusLabel('documentStatus', s) }))]} />
        </div>
        <div className="w-48">
          <SelectField name="documents-kind" label={t.kind} value={kind || 'all'} onChange={(v) => setKind(v === 'all' ? '' : v)} options={[{ id: 'all', label: ru.reference.common.all }, ...KINDS.map((k) => ({ id: k, label: statusLabel('documentKind', k) }))]} />
        </div>
        <div className="w-64">
          <EntityPicker name="documents-owner" label={t.owner} kind="owners" value={ownerId || null} onChange={(id) => setOwnerId(id ?? '')} />
        </div>
        {ownerId ? (
          <button type="button" className="text-sm text-accent hover:underline" data-testid="action-clear-owner" onClick={() => setOwnerId('')}>
            {names.get(ownerId) ?? ownerId} ×
          </button>
        ) : null}
      </div>
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.empty}>
        {(rows) => (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-muted" data-testid="documents-count">
              {fmt(ru.reference.common.count, { n: rows.length })}
            </div>
            <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `document-${r.id}`} gridStateKey="grid" />
          </div>
        )}
      </QueryView>
      {dialog?.kind === 'create' ? <CreateDocumentDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'attach' ? <AttachDialog documentId={dialog.doc.id} title={dialog.doc.title} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === 'approve' ? <ApproveDocumentDialog documentId={dialog.doc.id} doc={dialog.doc} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
