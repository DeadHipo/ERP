import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { sublabelListItemSchema } from '@erp/shared/api-responses';
import { sublabelQueries } from '../../../api/queries/sublabels';
import { ActionButton } from '../../../components/ActionButton';
import { CardTabs } from '../../../components/EntityCard';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { ru } from '../../../i18n/ru';
import { formatCount } from '../../../lib/money';
import { NameDialog } from './dialogs';
import { SuggestionsTab } from './SuggestionsTab';
import { TermsTab } from './TermsTab';

const t = ru.sublabels;
type Sublabel = z.output<typeof sublabelListItemSchema>;

function ListTab() {
  const list = useQuery(sublabelQueries.list());
  const [creating, setCreating] = useState(false);
  const columns = useMemo<ColDef<Sublabel>[]>(
    () => [
      {
        colId: 'name',
        headerName: t.cols.name,
        minWidth: 260,
        valueGetter: (p) => p.data?.name,
        cellRenderer: (p: { data?: Sublabel }) =>
          p.data ? (
            <Link className="text-accent hover:underline" data-testid={`sublabel-link-${p.data.id}`} to={`/sublabels/${p.data.id}`}>
              {p.data.name}
            </Link>
          ) : null,
      },
      { colId: 'tracksNow', headerName: t.cols.tracksNow, valueGetter: (p) => (p.data ? formatCount(p.data.tracksNow) : '') },
      { colId: 'withoutDocument', headerName: t.cols.withoutDocument, valueGetter: (p) => (p.data ? formatCount(p.data.withoutDocument) : '') },
    ],
    [],
  );
  return (
    <div className="flex flex-col gap-3">
      <div>
        <ActionButton name="create-sublabel" op="POST /sublabels" onPress={() => setCreating(true)}>
          {t.create}
        </ActionButton>
      </div>
      <QueryView query={list} isEmpty={(d) => d.length === 0} emptyMessage={t.noSublabels}>
        {(rows) => (
          <DataGrid
            rowData={rows}
            columnDefs={columns}
            getRowId={(s) => s.id}
            rowTestId={(s) => `sublabel-${s.id}`}
            rowAttributes={(s) => ({ 'data-tracks-now': String(s.tracksNow), 'data-without-document': String(s.withoutDocument) })}
          />
        )}
      </QueryView>
      {creating ? <NameDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

/** P36 (D-220): the register of sublabels and their tracks; the money still follows the label rules until the switch. */
export function SublabelsPage() {
  return (
    <div data-testid="sublabels-page">
      <PageHeader title={t.title} subtitle={t.subtitle} />
      <CardTabs
        tabs={[
          { id: 'list', label: t.tabs.list, content: <ListTab /> },
          { id: 'terms', label: t.tabs.terms, content: <TermsTab /> },
          { id: 'suggestions', label: t.tabs.suggestions, content: <SuggestionsTab /> },
        ]}
      />
    </div>
  );
}
