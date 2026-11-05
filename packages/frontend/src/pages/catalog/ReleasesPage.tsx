import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { releasesSchema } from '@erp/shared/api-responses';
import { releaseQueries } from '../../api/queries/releases';
import { ArtistLinks, artistsText } from '../../components/ArtistLinks';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { DataGrid } from '../../components/grid/DataGrid';
import { TextField } from '../../components/fields/TextField';
import { compareDecimal } from '../../lib/money';
import { ru } from '../../i18n/ru';
import { useUrlParam } from './components/url';

type Item = z.output<typeof releasesSchema>['items'][number];
const t = ru.catalog.releases;

/** P7 «Релизы»: `GET /releases?q` (net of the loaded files per UPC, no calculation); `q` lives in the URL. */
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
  const query = useQuery(releaseQueries.list(q || undefined));
  const columns = useMemo(() => releaseColumns(), []);
  return (
    <div data-testid="releases-page">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <div className="mb-3 w-72">
        <TextField name="releases-q" label={t.q} value={text} onChange={setText} type="search" />
      </div>
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
