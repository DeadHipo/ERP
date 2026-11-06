import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { documentKind } from '@erp/shared/api-schemas';
import type { DocumentView } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { splitQueries } from '../../../api/queries/splits';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { statusLabel } from '../../../components/StatusChip';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { LabelField, useLabelChoice } from '../../../components/fields/LabelField';
import { useOwnLabels } from '../../../components/LabelSwitch';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.reference.documents;
type Kind = z.output<typeof documentKind>;
export const KINDS: readonly Kind[] = ['contract', 'appendix', 'buyout', 'advance_basis', 'adjustment_basis', 'payment_proof', 'return_proof', 'other', 'assumption'];

/**
 * «Создать документ» (`POST /documents`, no confirmation). The label of the document (D-169, `field-document-label`):
 * default the switch, «любой лейбл» allowed (sent as no `labelId`).
 */
export function CreateDocumentDialog(props: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('appendix');
  const [title, setTitle] = useState('');
  const [fileRef, setFileRef] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const { labelId, setLabelId } = useLabelChoice();
  const run = useAction(
    () =>
      api.documents.create({
        kind,
        title: title.trim(),
        fileRef: fileRef.trim() || null,
        ownerId: owner,
        requiresApproval: kind !== 'assumption',
        labelId: labelId || null,
      }),
    { invalidate: 'all', success: (d) => fmt(t.created, { title: d.title }) },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.create}
      subtitle={t.createSubtitle}
      footer={
        <ActionButton
          name="create-document-submit"
          isPending={run.isPending}
          isDisabled={title.trim() === ''}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {ru.common.create}
        </ActionButton>
      }
    >
      <SelectField name="document-kind" label={t.kindField} value={kind} onChange={(v) => setKind(KINDS.find((k) => k === v) ?? kind)} options={KINDS.map((k) => ({ id: k, label: statusLabel('documentKind', k) }))} />
      <TextField name="document-title" label={t.titleField} value={title} onChange={setTitle} isRequired />
      <TextField name="document-file-ref" label={t.fileRef} value={fileRef} onChange={setFileRef} />
      <EntityPicker name="document-owner" label={t.ownerOptional} kind="owners" value={owner} onChange={(id) => setOwner(id)} />
      <LabelField name="document-label" label={t.labelField} value={labelId} onChange={setLabelId} anyLabel={t.anyLabelOption} />
      <p className="text-xs text-muted">{t.labelHint}</p>
    </FormDialog>
  );
}

/** The name of a document's own label for a cell or the card; null = «любой» (D-169). */
export function useDocumentLabelName(): (labelId: string | null) => string {
  const own = useOwnLabels();
  return (labelId) => (labelId === null ? t.anyLabel : (own.find((l) => l.id === labelId)?.name ?? labelId));
}

/** «Изменить лейбл» of P14 (`PATCH /documents/:id`, D-169): an own label or «любой лейбл» (null). */
export function SetDocumentLabelDialog(props: { doc: DocumentView; onClose: () => void }) {
  const [labelId, setLabelId] = useState(props.doc.labelId ?? '');
  const name = useDocumentLabelName();
  const run = useAction(() => api.documents.setLabel(props.doc.id, { labelId: labelId || null }), {
    invalidate: 'all',
    success: (d) => fmt(t.labelSet, { title: d.title, label: name(d.labelId) }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.setLabelTitle}
      subtitle={t.labelHint}
      footer={
        <ActionButton
          name="set-document-label-submit"
          isPending={run.isPending}
          isDisabled={labelId === (props.doc.labelId ?? '')}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {ru.common.save}
        </ActionButton>
      }
    >
      <div className="text-sm">
        <b>{props.doc.title}</b>
      </div>
      <LabelField name="document-label" label={t.labelField} value={labelId} onChange={setLabelId} anyLabel={t.anyLabelOption} />
    </FormDialog>
  );
}

/** «Приложить файл» (`POST /documents/:id/attach`). */
export function AttachDialog(props: { documentId: string; title: string; onClose: () => void }) {
  const [fileRef, setFileRef] = useState('');
  const run = useAction(() => api.documents.attach(props.documentId, { fileRef: fileRef.trim() }), {
    invalidate: 'all',
    success: (d) => fmt(t.attached, { title: d.title }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.attachTitle}
      footer={
        <ActionButton
          name="attach-submit"
          isPending={run.isPending}
          isDisabled={fileRef.trim() === ''}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {t.attach}
        </ActionButton>
      }
    >
      <div className="text-sm">
        <b>{props.title}</b>
      </div>
      <TextField name="attach-file-ref" label={t.fileRef} value={fileRef} onChange={setFileRef} isRequired />
    </FormDialog>
  );
}

/** «Подтвердить сплит этим документом»: pick an ISRC, then its split without a document (`POST /splits/:id/confirm`). */
export function ConfirmSplitWithDocumentDialog(props: { documentId: string; title: string; onClose: () => void }) {
  const [isrc, setIsrc] = useState<string | null>(null);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const splits = useQuery({ ...splitQueries.page({ isrc: isrc ?? undefined, limit: 500 }), enabled: isrc !== null });
  const open = (splits.data?.items ?? []).filter((s) => s.documentId === null);
  const split = open.find((s) => s.id === splitId);
  const run = useAction((id: string) => api.splits.confirm(id, { documentId: props.documentId }), {
    invalidate: 'all',
    success: (s) => fmt(ru.actions.toast.splitConfirmed, { isrc: s.isrc }),
  });
  const rows = split ? split.shares.map((s) => `${s.pseudonym} ${s.percent} %`).join(', ') : '';
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.confirmSplit}
        subtitle={t.confirmSplitSubtitle}
        footer={
          <ActionButton name="confirm-split-submit" isPending={run.isPending} isDisabled={!split} reason={ru.actions.hints.fillFields} onPress={() => setConfirm(true)}>
            {ru.actions.confirmSplit}
          </ActionButton>
        }
      >
        <EntityPicker name="confirm-isrc" label={t.pickIsrc} kind="tracks" value={isrc} onChange={(id) => { setIsrc(id); setSplitId(null); }} />
        {isrc ? (
          open.length === 0 ? (
            <p className="text-sm text-muted">{splits.data ? t.noSplitsForIsrc : ru.common.loading}</p>
          ) : (
            <SelectField
              name="confirm-split-pick"
              label={t.pickSplit}
              value={splitId}
              onChange={setSplitId}
              options={open.map((s) => ({ id: s.id, label: `${s.validFrom} → ${s.validTo ?? ru.reference.common.open}: ${s.shares.map((x) => `${x.pseudonym} ${x.percent} %`).join(', ')}` }))}
            />
          )
        ) : null}
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={ru.actions.confirm.confirmSplitTitle}
        lines={[...ru.actions.confirm.confirmSplitLines(isrc ?? '', rows, split ? `${split.validFrom} → ${split.validTo ?? ru.reference.common.open}` : '', props.title)]}
        isPending={run.isPending}
        onConfirm={() => split && run.mutate(split.id, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}
