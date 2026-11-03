import { useState } from 'react';
import type { z } from 'zod';
import type { documentKind } from '@erp/shared/api-schemas';
import type { DocumentView } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { StatusChip, statusLabel } from '../../../components/StatusChip';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { useOperator } from '../../../lib/operator';
import { fmt, ru } from '../../../i18n/ru';
import { useApproveLines } from './approve-lines';

type Kind = z.output<typeof documentKind>;
export type ReadyDocument = { id: string; title: string };

const a = ru.actions;

/**
 * The document part of an action (17 §6): pick an approved document, or create one with its file reference
 * (`POST /documents`, the file is attached by the same call) and approve it (`POST /documents/:id/approve`, with the
 * confirmation). `onReady` gets the approved document; the final step of the action is enabled from then on.
 */
export function DocumentStep(props: {
  /** The kinds the action accepts (the first is the default for a new document). */
  kinds: readonly Kind[];
  defaultTitle: string;
  /** The owner of a new document (a contract confirms only its own owner). */
  ownerId?: string | null;
  ready: ReadyDocument | null;
  onReady: (doc: ReadyDocument | null) => void;
  /** Hide "pick an existing one" (a contract of an owner is a new document). */
  newOnly?: boolean;
}) {
  const { operator } = useOperator();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [kind, setKind] = useState<Kind>(props.kinds[0] ?? 'appendix');
  const [title, setTitle] = useState(props.defaultTitle);
  const [fileRef, setFileRef] = useState('');
  const [created, setCreated] = useState<DocumentView | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const approveText = useApproveLines(created, confirmOpen);

  const create = useAction(
    () =>
      api.documents.create({
        kind,
        title: title.trim(),
        fileRef: fileRef.trim() || null,
        ownerId: props.ownerId ?? null,
        requiresApproval: true,
      }),
    { invalidate: 'reference', success: (d) => fmt(a.toast.documentCreated, { title: d.title }) },
  );
  const approve = useAction((id: string) => api.documents.approve(id, { by: operator }), {
    invalidate: 'all',
    success: (d) => fmt(a.toast.approved, { title: d.title }),
  });

  if (props.ready) {
    return (
      <div data-testid="document-ready" className="rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
        {fmt(a.steps.documentReady, { title: props.ready.title })} <StatusChip kind="documentStatus" value="approved" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3" data-testid="document-step">
      {props.newOnly ? null : (
        <SelectField
          name="document-mode"
          label={a.fields.mode}
          value={mode}
          onChange={(v) => setMode(v === 'existing' ? 'existing' : 'new')}
          options={[
            { id: 'new', label: a.fields.modeNew },
            { id: 'existing', label: a.fields.modeExisting },
          ]}
        />
      )}
      {mode === 'existing' && !props.newOnly ? (
        <EntityPicker
          name="document-existing"
          label={a.fields.existing}
          kind="documents"
          value={null}
          accept={(i) => i.status === 'approved' && props.kinds.some((k) => k === i.kind)}
          onChange={(id, label) => props.onReady(id ? { id, title: label } : null)}
        />
      ) : created ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="document-created">
          {fmt(a.steps.documentCreated, { title: created.title })}
          <StatusChip kind="documentStatus" value={created.status} />
          <ActionButton name="document-approve" isPending={approve.isPending} onPress={() => setConfirmOpen(true)}>
            {a.steps.approve}
          </ActionButton>
          <ConfirmDialog
            isOpen={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={a.confirm.approveTitle}
            lines={approveText.lines}
            isLoading={approveText.loading}
            isPending={approve.isPending}
            onConfirm={() =>
              approve.mutate(created.id, {
                onSuccess: (d) => {
                  setConfirmOpen(false);
                  props.onReady({ id: d.id, title: d.title });
                },
                onError: () => setConfirmOpen(false),
              })
            }
          />
        </div>
      ) : (
        <>
          {props.kinds.length > 1 ? (
            <SelectField
              name="document-kind"
              label={a.fields.kind}
              value={kind}
              onChange={(v) => setKind(props.kinds.find((k) => k === v) ?? kind)}
              options={props.kinds.map((k) => ({ id: k, label: statusLabel('documentKind', k) }))}
            />
          ) : null}
          <TextField name="document-title" label={a.fields.title} value={title} onChange={setTitle} isRequired />
          <TextField name="document-file" label={a.fields.fileRef} value={fileRef} onChange={setFileRef} isRequired />
          <div>
            <ActionButton
              name="document-create"
              isPending={create.isPending}
              isDisabled={title.trim() === '' || fileRef.trim() === ''}
              onPress={() => create.mutate(undefined, { onSuccess: (d) => setCreated(d) })}
            >
              {a.steps.createDocument}
            </ActionButton>
          </div>
        </>
      )}
    </div>
  );
}
