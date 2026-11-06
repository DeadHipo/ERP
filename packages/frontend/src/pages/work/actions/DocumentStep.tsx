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
import { useLabel } from '../../../lib/label';
import { useOwnLabels } from '../../../components/LabelSwitch';
import { useOperator } from '../../../lib/operator';
import { fmt, ru } from '../../../i18n/ru';
import { useApproveLines } from './approve-lines';

type Kind = z.output<typeof documentKind>;
export type ReadyDocument = { id: string; title: string };

const a = ru.actions;
/** The «любой лейбл» option of the document label under «Все»: sent as no `labelId`. */
const ANY_LABEL = '__any__';

/**
 * The document part of an action (17 §6): pick an approved document, or create one with its file reference
 * (`POST /documents`, the file is attached by the same call) and approve it (`POST /documents/:id/approve`, with the
 * confirmation). `onReady` gets the approved document; the final step of the action is enabled from then on.
 * A new document carries the label of the switch (D-169: a contract opens the label of its document), or `labelId` when
 * the action has its own label field (an operation). Nothing is sent silently without a label: under «Все» the step asks
 * for the label of the document (`field-document-step-label`, an own label or «любой лейбл»), and an action whose own
 * label is still empty keeps `action-document-create` closed until it is chosen.
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
  /** The own label of a new document; default the switch ('' = any label). */
  labelId?: string;
}) {
  const { operator } = useOperator();
  const { labelId: switchLabel } = useLabel();
  const own = useOwnLabels();
  // under «Все» (no label of the action) the operator chooses the label of the document; null = not chosen yet
  const asks = props.labelId === undefined && switchLabel === '';
  const [chosen, setChosen] = useState<string | null>(null);
  const labelId = asks ? (chosen === ANY_LABEL ? '' : (chosen ?? '')) : (props.labelId ?? switchLabel);
  const labelReady = asks ? chosen !== null : labelId !== '';
  const labelReason = asks ? a.fields.documentLabelPick : ru.shell.label.pick;
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
        labelId: labelId || null,
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
          <ActionButton name="document-approve" op="POST /documents/:id/approve" isPending={approve.isPending} onPress={() => setConfirmOpen(true)}>
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
          {asks ? (
            <SelectField
              name="document-step-label"
              label={a.fields.documentLabel}
              value={chosen}
              onChange={setChosen}
              isRequired
              options={[{ id: ANY_LABEL, label: a.fields.documentLabelAny }, ...own.map((l) => ({ id: l.id, label: l.name }))]}
            />
          ) : null}
          <TextField name="document-title" label={a.fields.title} value={title} onChange={setTitle} isRequired />
          <TextField name="document-file" label={a.fields.fileRef} value={fileRef} onChange={setFileRef} isRequired />
          <div>
            <ActionButton
              name="document-create" op="POST /documents"
              isPending={create.isPending}
              isDisabled={title.trim() === '' || fileRef.trim() === '' || !labelReady}
              reason={labelReady ? undefined : labelReason}
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
