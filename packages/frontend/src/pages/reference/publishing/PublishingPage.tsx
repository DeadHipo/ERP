import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColDef } from 'ag-grid-community';
import type { z } from 'zod';
import type { publishingWriterSchema } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ownerQueries } from '../../../api/queries/owners';
import { publishingQueries } from '../../../api/queries/publishing';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { FormDialog } from '../../../components/FormDialog';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { DataGrid } from '../../../components/grid/DataGrid';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { SelectField } from '../../../components/fields/SelectField';
import { fmt, ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';
import { PublishingTermsDialog } from '../../work/actions/dialogs';
import { OwnerLink, useOwnerNames } from '../shared';

const t = ru.reference.publishing;
type Writer = z.output<typeof publishingWriterSchema>;

const resolutionLabel = (v: string): string => (t.resolution as Record<string, string>)[v] ?? v;

function MapWriterDialog(props: { writer: Writer; onClose: () => void }) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [owner, setOwner] = useState<string | null>(null);
  const run = useAction(
    () => api.publishing.mapWriter(props.writer.writerNorm, mode === 'new' ? { createNew: true } : { ownerId: owner }),
    { invalidate: 'all', success: () => fmt(t.mapped, { name: props.writer.displayName }) },
  );
  const ready = mode === 'new' || owner !== null;
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.mapTitle}
      footer={
        <ActionButton name="writer-submit" isPending={run.isPending} isDisabled={!ready} reason={ru.actions.hints.fillFields} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}>
          {t.map}
        </ActionButton>
      }
    >
      <div className="text-sm">
        {t.cols.name}: <b>{props.writer.displayName}</b>
      </div>
      <SelectField name="writer-mode" label={t.mapMode} value={mode} onChange={(v) => setMode(v === 'new' ? 'new' : 'existing')} options={[{ id: 'existing', label: t.mapExisting }, { id: 'new', label: t.mapCreate }]} />
      {mode === 'existing' ? <EntityPicker name="writer-owner" label={t.mapOwner} kind="owners" value={owner} onChange={(id) => setOwner(id)} /> : null}
    </FormDialog>
  );
}

function TermsSection() {
  const [owner, setOwner] = useState<{ id: string; label: string } | null>(null);
  const [open, setOpen] = useState(false);
  const detail = useQuery({ ...ownerQueries.detail(owner?.id ?? ''), enabled: owner !== null });
  const terms = detail.data?.publishingTerms ?? [];
  return (
    <section data-testid="terms-section">
      <h2 className="mb-2 text-sm font-medium">{t.terms}</h2>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-80">
          <EntityPicker name="terms-owner-pick" label={t.termsOwner} kind="owners" value={owner?.id ?? null} onChange={(id, label) => setOwner(id ? { id, label } : null)} />
        </div>
        {owner ? (
          <ActionButton name="set-terms" onPress={() => setOpen(true)}>
            {t.setTerms}
          </ActionButton>
        ) : null}
      </div>
      {!owner ? (
        <p className="text-sm text-muted">{t.termsPick}</p>
      ) : terms.length === 0 ? (
        <p className="text-sm text-muted" data-testid="terms-empty">{t.termsEmpty}</p>
      ) : (
        <SimpleTable testId="terms-list" headers={[t.termsCols.percent, t.termsCols.operationType, t.termsCols.from, t.termsCols.to, t.termsCols.document]}>
          {terms.map((x) => (
            <tr key={x.id} data-testid={`terms-${x.id}`} className="border-t border-border">
              <Td col="percent">{x.percent}</Td>
              <Td col="operationType">{x.operationType ?? t.allTypes}</Td>
              <Td col="from">{x.validFrom}</Td>
              <Td col="to">{x.validTo ?? ru.reference.common.open}</Td>
              <Td>{x.documentId ? <EntityLink kind="document" id={x.documentId} label="→" /> : '—'}</Td>
            </tr>
          ))}
        </SimpleTable>
      )}
      {open && owner ? <PublishingTermsDialog ownerId={owner.id} ownerLabel={owner.label} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

/** P18 «Паблишинг» `/publishing`: the writers of the B17 statements and their owners; the terms of an owner. */
export function PublishingPage() {
  const query = useQuery(publishingQueries.writers());
  const names = useOwnerNames();
  const [mapping, setMapping] = useState<Writer | null>(null);
  const resolve = useAction(() => api.publishing.resolveWriters(), {
    invalidate: 'all',
    success: (r) => fmt(t.resolved, { matched: r.matched, created: r.created, ambiguous: r.ambiguous, external: r.external }),
  });
  const columns = useMemo<ColDef<Writer>[]>(
    () => [
      { colId: 'name', headerName: t.cols.name, minWidth: 220, valueGetter: (p) => p.data?.displayName },
      { colId: 'role', headerName: t.cols.role, valueGetter: (p) => (p.data ? t.role[p.data.role] : '') },
      {
        colId: 'resolution',
        headerName: t.cols.resolution,
        valueGetter: (p) => (p.data ? resolutionLabel(p.data.resolution) : ''),
        cellRenderer: (p: { data?: Writer }) => (p.data ? <span data-testid={`resolution-${p.data.resolution}`}>{resolutionLabel(p.data.resolution)}</span> : null),
      },
      { colId: 'owner', headerName: t.cols.owner, valueGetter: (p) => (p.data?.ownerId ? (names.get(p.data.ownerId) ?? '') : ''), cellRenderer: (p: { data?: Writer }) => (p.data ? <OwnerLink ownerId={p.data.ownerId} names={names} /> : null) },
      {
        colId: 'actions',
        headerName: t.cols.actions,
        sortable: false,
        filter: false,
        cellRenderer: (p: { data?: Writer }) =>
          p.data ? (
            <ActionButton name="map-writer" variant="secondary" onPress={() => p.data && setMapping(p.data)}>
              {t.map}
            </ActionButton>
          ) : null,
      },
    ],
    [names],
  );
  return (
    <div data-testid="publishing-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <ActionButton name="resolve-writers" isPending={resolve.isPending} onPress={() => resolve.mutate(undefined)}>
            {t.resolve}
          </ActionButton>
        }
      />
      <div className="flex flex-col gap-6">
        <section>
          <h2 className="mb-2 text-sm font-medium">{t.writers}</h2>
          <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.noWriters}>
            {(rows) => <DataGrid rowData={rows} columnDefs={columns} getRowId={(w) => w.writerNorm} rowTestId={(w) => `writer-${w.writerNorm}`} gridStateKey="grid" height="420px" />}
          </QueryView>
        </section>
        <TermsSection />
      </div>
      {mapping ? <MapWriterDialog writer={mapping} onClose={() => setMapping(null)} /> : null}
    </div>
  );
}
