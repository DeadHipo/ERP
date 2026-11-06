import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { releaseRegistrySchema, releasesSchema } from '@erp/shared/api-responses';
import { releaseQueries } from '../../api/queries/releases';
import { ArtistLinks, artistsText } from '../../components/ArtistLinks';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { ActionButton } from '../../components/ActionButton';
import { DataGrid } from '../../components/grid/DataGrid';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { compareDecimal } from '../../lib/money';
import { formatDateTime } from '../../lib/datetime';
import { ru } from '../../i18n/ru';
import { ReleaseImportDialog } from './ReleaseImportDialog';
import { useLabel } from '../../lib/label';
import { useUrlParam } from './components/url';

type Item = z.output<typeof releasesSchema>['items'][number];
type RegistryItem = z.output<typeof releaseRegistrySchema>['items'][number];
const t = ru.catalog.releases;

/**
 * P7 «Релизы»: `GET /releases?q` (net of the loaded files per UPC, no calculation; D-172: whether the UPC is in the
 * release registry and its track count there); `q` lives in the URL. `?view=registry` is the registry itself
 * (`GET /releases/registry`, no money); «Загрузить реестр релизов» opens `ReleaseImportDialog`.
 */
export function ReleasesPage() {
  const [q, setQ] = useUrlParam('q');
  const [text, setText] = useState(q);
  // The server filters; the typed text reaches the URL (and the request) after a short pause.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (text.trim() !== q) setQ(text.trim());
    }, 300);
    return () => clearTimeout(timer);
  }, [text, q, setQ]);
  const { labelId } = useLabel(); // the label view (D-168): the tracks of the label's ISRCs, the net of its units
  const [view, setView] = useUrlParam('view');
  const registryView = view === 'registry';
  const query = useQuery({ ...releaseQueries.list(q || undefined, labelId), enabled: !registryView });
  const registry = useQuery({ ...releaseQueries.registry(q || undefined, labelId), enabled: registryView });
  const columns = useMemo(() => releaseColumns(), []);
  const registryCols = useMemo(() => registryColumns(), []);
  const [importing, setImporting] = useState(false);
  return (
    <div data-testid="releases-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ActionButton name="import-releases" write={false} op="POST /releases/import" variant="secondary" onPress={() => setImporting(true)}>
            {t.import}
          </ActionButton>
        }
      />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-72">
          <TextField name="releases-q" label={t.q} value={text} onChange={setText} type="search" />
        </div>
        <div className="w-60">
          <SelectField
            name="releases-view"
            label={t.viewUnits}
            value={registryView ? 'registry' : 'units'}
            onChange={(v) => setView(v === 'registry' ? 'registry' : '')}
            options={[
              { id: 'units', label: t.viewUnits },
              { id: 'registry', label: t.viewRegistry },
            ]}
          />
        </div>
      </div>
      {importing ? <ReleaseImportDialog onClose={() => setImporting(false)} /> : null}
      {registryView ? (
        <QueryView query={registry} isEmpty={(d) => d.items.length === 0} emptyMessage={t.registryEmpty}>
          {(data) => (
            <DataGrid
              rowData={data.items}
              columnDefs={registryCols}
              getRowId={(r) => `${r.labelId}|${r.upc}`}
              rowTestId={(r) => `registry-${r.labelId}-${r.upc}`}
              gridStateKey="registry"
            />
          )}
        </QueryView>
      ) : (
      <QueryView query={query} money isEmpty={(d) => d.items.length === 0} emptyMessage={t.empty}>
        {(data) => (
          <DataGrid
            rowData={data.items}
            columnDefs={columns}
            getRowId={(r) => r.upc}
            rowTestId={(r) => `release-${r.upc}`}
            gridStateKey="grid"
          />
        )}
      </QueryView>
      )}
    </div>
  );
}

function releaseColumns(): ColDef<Item>[] {
  const c = t.cols;
  return [
    {
      colId: 'upc',
      headerName: c.upc,
      minWidth: 160,
      valueGetter: (p) => p.data?.upc,
      cellRenderer: (p: { data?: Item }) => (p.data ? <EntityLink kind="upc" id={p.data.upc} /> : null),
    },
    { colId: 'title', headerName: c.title, minWidth: 180, valueGetter: (p) => p.data?.title },
    // The pseudonyms over the tracks of the UPC as links to P12 (D-166); the report string when the registry names none.
    {
      colId: 'artist',
      headerName: c.artist,
      minWidth: 180,
      wrapText: true,
      autoHeight: true,
      valueGetter: (p) => (p.data ? artistsText(p.data.artists, p.data.artistName) : ''),
      cellRenderer: (p: { data?: Item }) => (p.data ? <ArtistLinks artists={p.data.artists} reportName={p.data.artistName} /> : null),
    },
    { colId: 'trackCount', headerName: c.trackCount, maxWidth: 110, valueGetter: (p) => p.data?.trackCount },
    // D-172: the release registry of the label (the Believe export); under «Все» the last imported row
    {
      colId: 'registered',
      headerName: c.registered,
      maxWidth: 120,
      valueGetter: (p) => (p.data?.registered ? t.yes : t.no),
      cellRenderer: (p: { data?: Item }) =>
        p.data ? (
          <span data-col="registered" data-value={p.data.registered ? 'true' : 'false'} data-label-id={p.data.registry?.labelId ?? ''}>
            {p.data.registered ? t.yes : t.no}
          </span>
        ) : null,
    },
    {
      colId: 'registryTrackCount',
      headerName: c.registryCount,
      maxWidth: 140,
      valueGetter: (p) => p.data?.registry?.trackCount ?? null,
      cellRenderer: (p: { data?: Item }) => (p.data ? <span data-col="registryTrackCount">{p.data.registry?.trackCount ?? '—'}</span> : null),
    },
    {
      colId: 'net',
      headerName: c.net,
      minWidth: 130,
      filter: false,
      comparator: compareDecimal,
      valueGetter: (p) => p.data?.net,
      cellRenderer: (p: { data?: Item }) =>
        p.data ? (
          <span data-col="net">
            <Money value={p.data.net} />
          </span>
        ) : null,
    },
  ];
}

function registryColumns(): ColDef<RegistryItem>[] {
  const c = t.registryCols;
  return [
    { colId: 'label', headerName: c.label, valueGetter: (p) => p.data?.labelName },
    {
      colId: 'upc',
      headerName: c.upc,
      minWidth: 160,
      valueGetter: (p) => p.data?.upc,
      cellRenderer: (p: { data?: RegistryItem }) => (p.data ? <EntityLink kind="upc" id={p.data.upc} /> : null),
    },
    { colId: 'title', headerName: c.title, minWidth: 180, valueGetter: (p) => p.data?.title },
    { colId: 'version', headerName: c.version, valueGetter: (p) => p.data?.version ?? '' },
    { colId: 'artist', headerName: c.artist, minWidth: 160, valueGetter: (p) => p.data?.artistString ?? '' },
    { colId: 'releaseDate', headerName: c.releaseDate, valueGetter: (p) => p.data?.releaseDate ?? '' },
    {
      colId: 'trackCount',
      headerName: c.trackCount,
      maxWidth: 110,
      valueGetter: (p) => p.data?.trackCount ?? null,
      cellRenderer: (p: { data?: RegistryItem }) => (p.data ? <span data-col="trackCount">{p.data.trackCount ?? '—'}</span> : null),
    },
    {
      colId: 'isrcsInUnits',
      headerName: c.isrcsInUnits,
      maxWidth: 130,
      valueGetter: (p) => p.data?.isrcsInUnits,
      cellRenderer: (p: { data?: RegistryItem }) => (p.data ? <span data-col="isrcsInUnits">{p.data.isrcsInUnits}</span> : null),
    },
    { colId: 'catalogNumber', headerName: c.catalogNumber, valueGetter: (p) => p.data?.catalogNumber ?? '' },
    { colId: 'importedAt', headerName: c.importedAt, valueGetter: (p) => (p.data ? formatDateTime(p.data.importedAt) : '') },
  ];
}
