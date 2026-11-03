import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { artistListItemSchema } from '@erp/shared/api-responses';
import { artistQueries } from '../../../api/queries/artists';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { StatusChip, statusLabel } from '../../../components/StatusChip';
import { DataGrid } from '../../../components/grid/DataGrid';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { useUrlParam } from '../../catalog/components/url';
import { OwnerLink, useOwnerNames } from '../shared';
import { CreateArtistDialog } from './CreateArtistDialog';

const t = ru.reference.artists;
type Row = z.output<typeof artistListItemSchema>;
const STATUSES = ['no_owner', 'unconfirmed', 'confirmed'] as const;

/** P11 «Псевдонимы» `/artists?q&status`: `GET /artists`, filtered on the client (the URL keeps the filters). */
export function ArtistsPage() {
  const [q, setQ] = useUrlParam('q');
  const [status, setStatus] = useUrlParam('status');
  const [creating, setCreating] = useState(false);
  const query = useQuery(artistQueries.list());
  const names = useOwnerNames();
  const columns = useMemo<ColDef<Row>[]>(
    () => [
      {
        colId: 'pseudonym',
        headerName: t.cols.pseudonym,
        valueGetter: (p) => p.data?.pseudonym,
        cellRenderer: (p: { data?: Row }) => (p.data ? <EntityLink kind="artist" id={p.data.id} label={p.data.pseudonym} /> : null),
      },
      {
        colId: 'owner',
        headerName: t.cols.owner,
        valueGetter: (p) => (p.data?.ownerId ? (names.get(p.data.ownerId) ?? p.data.ownerId) : ''),
        cellRenderer: (p: { data?: Row }) => (p.data ? <OwnerLink ownerId={p.data.ownerId} names={names} /> : null),
      },
      {
        colId: 'status',
        headerName: t.cols.status,
        valueGetter: (p) => (p.data ? statusLabel('artistStatus', p.data.status) : ''),
        cellRenderer: (p: { data?: Row }) => (p.data ? <StatusChip kind="artistStatus" value={p.data.status} /> : null),
      },
    ],
    [names],
  );
  return (
    <div data-testid="artists-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <>
            <Link to="/artists/duplicates" className="text-sm text-accent hover:underline" data-testid="link-duplicates">
              {t.duplicatesLink}
            </Link>
            <ActionButton name="create-artist" onPress={() => setCreating(true)}>
              {t.create}
            </ActionButton>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-72">
          <TextField name="artists-q" label={t.q} value={q} onChange={setQ} type="search" />
        </div>
        <div className="w-52">
          <SelectField
            name="artists-status"
            label={t.status}
            value={status || 'all'}
            onChange={(v) => setStatus(v === 'all' ? '' : v)}
            options={[{ id: 'all', label: ru.reference.common.all }, ...STATUSES.map((s) => ({ id: s, label: statusLabel('artistStatus', s) }))]}
          />
        </div>
      </div>
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.empty}>
        {(data) => {
          const needle = q.trim().toLocaleLowerCase('ru');
          const rows = data.filter(
            (a) => (status === '' || a.status === status) && (needle === '' || a.pseudonym.toLocaleLowerCase('ru').includes(needle)),
          );
          return (
            <div className="flex flex-col gap-2">
              <div className="text-xs text-muted" data-testid="artists-count">
                {fmt(ru.reference.common.count, { n: rows.length })}
              </div>
              <DataGrid rowData={rows} columnDefs={columns} getRowId={(r) => r.id} rowTestId={(r) => `artist-${r.id}`} gridStateKey="grid" />
            </div>
          );
        }}
      </QueryView>
      {creating ? <CreateArtistDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
