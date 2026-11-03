import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { documentKind } from '@erp/shared/api-schemas';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ownerQueries } from '../../../api/queries/owners';
import { splitQueries } from '../../../api/queries/splits';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { statusLabel } from '../../../components/StatusChip';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.reference.documents;
type Kind = z.output<typeof documentKind>;
export const KINDS: readonly Kind[] = ['contract', 'appendix', 'buyout', 'advance_basis', 'adjustment_basis', 'payment_proof', 'return_proof', 'other', 'assumption'];

/** «Создать документ» (`POST /documents`, no confirmation). */
export function CreateDocumentDialog(props: { onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('appendix');
  const [title, setTitle] = useState('');
  const [fileRef, setFileRef] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const run = useAction(
    () =>
      api.documents.create({
        kind,
        title: title.trim(),
        fileRef: fileRef.trim() || null,
        ownerId: owner,
        requiresApproval: kind !== 'assumption',
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

/** «Создать договор с этим документом»: owner, its pseudonyms (several), `POST /contracts` after the confirmation. */
export function ContractFromDocumentDialog(props: { documentId: string; title: string; onClose: () => void }) {
  const [owner, setOwner] = useState<{ id: string; label: string } | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const detail = useQuery({ ...ownerQueries.detail(owner?.id ?? ''), enabled: owner !== null });
  const artists = detail.data?.artists ?? [];
  const picked = artists.filter((a) => chosen.has(a.id));
  const run = useAction(() => api.documents.createContract({ ownerId: owner?.id ?? '', documentId: props.documentId, artistIds: picked.map((a) => a.id) }), {
    invalidate: 'all',
    success: () => t.contractCreated,
  });
  const toggle = (id: string) =>
    setChosen((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.contractTitle}
        subtitle={t.contractSubtitle}
        footer={
          <ActionButton name="contract-submit" isPending={run.isPending} isDisabled={!owner || picked.length === 0} reason={ru.actions.hints.fillFields} onPress={() => setConfirm(true)}>
            {t.contractTitle}
          </ActionButton>
        }
      >
        <EntityPicker name="contract-owner" label={t.contractOwner} kind="owners" value={owner?.id ?? null} onChange={(id, label) => { setOwner(id ? { id, label } : null); setChosen(new Set()); }} />
        {owner ? (
          <fieldset className="flex flex-col gap-1" data-testid="contract-artists">
            <legend className="text-sm font-medium">{t.contractArtists}</legend>
            {artists.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" data-testid={`contract-artist-${a.id}`} checked={chosen.has(a.id)} onChange={() => toggle(a.id)} />
                {a.pseudonym}
              </label>
            ))}
          </fieldset>
        ) : null}
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={ru.actions.confirm.contractTitle}
        lines={[...t.contractConfirmLines(owner?.label ?? '', picked.map((a) => a.pseudonym).join(', '), props.title)]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}
