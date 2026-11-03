import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { documentQueries } from '../../../api/queries/documents';
import { ownerQueries } from '../../../api/queries/owners';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { DuplicateDialog, similarOf, type Similar } from '../../../components/DuplicateDialog';
import { FormDialog } from '../../../components/FormDialog';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { errorText } from '../../../i18n/ru/errors';
import { formatMoney } from '../../../lib/money';
import { fmt, ru } from '../../../i18n/ru';
import { DocumentStep, type ReadyDocument } from './DocumentStep';

// The owner actions of 17 §6, one component each, used by the queue, the signals, the owner card (P10), the pseudonym
// pages (P11) and the document card (P14): create a contract, merge into another owner, assign an owner to a pseudonym.

const a = ru.actions;
const f = a.fields;

type Owner = { id: string; label: string };

/** The text of an API error for a confirmation line (the Russian sentence of its code, else its message). */
const errorLine = (e: Error) => {
  const code = 'code' in e && typeof e.code === 'string' ? e.code : '';
  return errorText(code) ?? e.message;
};

/**
 * «Создать договор» (owner_unconfirmed, P10 Документы, P14): the owner (given, or picked when the caller is a document),
 * the pseudonyms it confirms (all by default, `contract-artist-<id>`), an optional number, an approved contract document
 * (given, or picked / created and approved in the document step) → ConfirmDialog → `POST /contracts`. The confirmation
 * states «ждёт этого документа» from `GET /documents/:id/uses` (OK disabled until it answers) and, from the queue, the
 * group's amount the contract unblocks.
 */
export function CreateContractDialog(props: {
  ownerId?: string;
  ownerLabel?: string;
  /** The document of the contract when the dialog is opened from it (P14). */
  document?: ReadyDocument;
  /** The queue group's amount (`GET /queue/owner_unconfirmed`), stated in the confirmation. */
  waiting?: string;
  /** Only a new document (the queue): no «выбрать утверждённый». */
  newDocumentOnly?: boolean;
  /** The submit hook: `action-<submitName>` (the queue's dialog uses `submit`). */
  submitName?: string;
  onClose: () => void;
}) {
  const [owner, setOwner] = useState<Owner | null>(props.ownerId ? { id: props.ownerId, label: props.ownerLabel ?? '' } : null);
  const detail = useQuery({ ...ownerQueries.detail(owner?.id ?? ''), enabled: owner !== null });
  const artists = detail.data?.artists ?? [];
  const ownerName = detail.data?.owner.name ?? owner?.label ?? '';
  // null = every pseudonym of the owner (the default); a list once the operator changes a checkbox.
  const [chosen, setChosen] = useState<string[] | null>(null);
  const picked = chosen === null ? artists : artists.filter((x) => chosen.includes(x.id));
  const [number, setNumber] = useState('');
  const [doc, setDoc] = useState<ReadyDocument | null>(props.document ?? null);
  const [confirm, setConfirm] = useState(false);
  const uses = useQuery({ ...documentQueries.uses(doc?.id ?? ''), enabled: confirm && doc !== null });
  const run = useAction(
    (args: { ownerId: string; documentId: string }) =>
      api.documents.createContract({
        ownerId: args.ownerId,
        documentId: args.documentId,
        number: number.trim() || null,
        artistIds: picked.map((x) => x.id),
      }),
    { invalidate: 'all', success: () => a.toast.contract },
  );
  const toggle = (id: string, on: boolean) =>
    setChosen((prev) => {
      const base = prev ?? artists.map((x) => x.id);
      return on ? [...base.filter((x) => x !== id), id] : base.filter((x) => x !== id);
    });
  const noArtistPicked = artists.length > 0 && picked.length === 0;
  const ready = owner !== null && detail.data !== undefined && doc !== null && !noArtistPicked;
  const lines = [
    ...a.confirm.contractLines(ownerName, picked.map((x) => x.pseudonym).join(', '), doc?.title ?? ''),
    ...(props.waiting ? [fmt(a.confirm.contractQueue, { amount: formatMoney(props.waiting) })] : []),
    uses.data
      ? fmt(a.confirm.waitingForDocument, { amount: formatMoney(uses.data.waiting.amount) })
      : uses.isError
        ? fmt(a.confirm.waitingUnknown, { error: errorLine(uses.error) })
        : null,
  ].filter((x): x is string => x !== null);
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={ru.money.documents.contractTitle}
        subtitle={props.waiting ? ru.reasonActions.owner_unconfirmed : ru.money.documents.contractSubtitle}
        footer={
          <ActionButton
            name={props.submitName ?? 'contract-submit'}
            isDisabled={!ready}
            reason={doc ? a.hints.fillFields : a.hints.pickFirst}
            isPending={run.isPending}
            onPress={() => setConfirm(true)}
          >
            {a.createContract}
          </ActionButton>
        }
      >
        {props.ownerId ? (
          <div className="text-sm">
            {f.owner}: <b>{ownerName}</b>
          </div>
        ) : (
          <EntityPicker
            name="contract-owner"
            label={ru.reference.documents.contractOwner}
            kind="owners"
            value={owner?.id ?? null}
            onChange={(id, label) => {
              setOwner(id ? { id, label } : null);
              setChosen(null);
            }}
          />
        )}
        {owner ? (
          <fieldset className="flex flex-col gap-1 text-sm" data-testid="contract-artists">
            <legend className="mb-1 font-medium">{ru.money.documents.contractArtists}</legend>
            {detail.data && artists.length === 0 ? <span className="text-muted">{a.hints.noPseudonyms}</span> : null}
            {artists.map((x) => (
              <label key={x.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  data-testid={`contract-artist-${x.id}`}
                  checked={picked.some((p) => p.id === x.id)}
                  onChange={(e) => toggle(x.id, e.target.checked)}
                />
                {x.pseudonym}
              </label>
            ))}
          </fieldset>
        ) : null}
        <TextField name="contract-number" label={ru.money.documents.contractNumber} value={number} onChange={setNumber} />
        {props.document ? (
          <div className="text-sm" data-testid="document-ready">
            {fmt(a.steps.documentReady, { title: props.document.title })}
          </div>
        ) : (
          <DocumentStep
            kinds={['contract']}
            newOnly={props.newDocumentOnly}
            ownerId={owner?.id ?? null}
            defaultTitle={`Договор ${ownerName}`.trim()}
            ready={doc}
            onReady={setDoc}
          />
        )}
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={a.confirm.contractTitle}
        lines={lines}
        isLoading={!uses.data && !uses.isError}
        isPending={run.isPending}
        onConfirm={() =>
          owner &&
          doc &&
          run.mutate({ ownerId: owner.id, documentId: doc.id }, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })
        }
      />
    </>
  );
}

/**
 * «Слить в другого владельца» (owner_unconfirmed, P10): the target owner and the reason → ConfirmDialog (from → into,
 * the pseudonyms and documents that move, the merged owner's earned / waiting / payable from one
 * `GET /owners/:id/balance`, «необратимо»; OK disabled until the balance answers) → `POST /owners/merge`. From the
 * owner card the page then opens the target. The direction rules are the backend's (`merge_direction`, ...).
 */
export function MergeOwnerDialog(props: { ownerId: string; ownerLabel?: string; openTarget?: boolean; onClose: () => void }) {
  const t = ru.money.merge;
  const navigate = useNavigate();
  const detail = useQuery(ownerQueries.detail(props.ownerId));
  const [into, setInto] = useState<Owner | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const balance = useQuery({ ...ownerQueries.balance(props.ownerId), enabled: confirm });
  const run = useAction((intoId: string) => api.owners.merge({ fromId: props.ownerId, intoId, reason: reason.trim() }), {
    invalidate: 'all',
    success: (o) => fmt(t.toast, { name: o.name }),
  });
  const name = detail.data?.owner.name ?? props.ownerLabel ?? '';
  const pseudonyms = (detail.data?.artists ?? []).map((x) => x.pseudonym).join(', ') || '—';
  const b = balance.data?.total;
  const lines = [
    fmt(t.lines.from, { name }),
    fmt(t.lines.into, { name: into?.label ?? '' }),
    fmt(t.lines.pseudonyms, { list: pseudonyms }),
    fmt(t.lines.documents, { n: detail.data?.documents.length ?? 0 }),
    b
      ? fmt(t.lines.money, { earned: formatMoney(b.earned), waiting: formatMoney(b.waiting), payable: formatMoney(b.payable) })
      : balance.isError
        ? fmt(a.confirm.waitingUnknown, { error: errorLine(balance.error) })
        : null,
    t.lines.irreversible,
  ].filter((x): x is string => x !== null);
  const filled = into !== null && reason.trim() !== '';
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.title}
        footer={
          <ActionButton
            name="merge-submit"
            isDisabled={!filled}
            reason={filled ? undefined : a.hints.fillFields}
            isPending={run.isPending}
            onPress={() => setConfirm(true)}
          >
            {t.submit}
          </ActionButton>
        }
      >
        <div className="text-sm">
          {f.owner}: <b>{name}</b> · {pseudonyms}
        </div>
        <EntityPicker
          name="merge-into"
          label={t.into}
          kind="owners"
          value={into?.id ?? null}
          accept={(i) => i.id !== props.ownerId}
          onChange={(id, label) => setInto(id ? { id, label } : null)}
        />
        <TextField name="merge-reason" label={t.reason} value={reason} onChange={setReason} isRequired />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.confirmTitle}
        lines={lines}
        isLoading={!balance.data && !balance.isError}
        isPending={run.isPending}
        onConfirm={() =>
          into &&
          run.mutate(into.id, {
            onSuccess: (o) => {
              props.onClose();
              if (props.openTarget) void navigate(`/owners/${encodeURIComponent(o.id)}`);
            },
            onSettled: () => setConfirm(false),
          })
        }
      />
    </>
  );
}

/**
 * «Привязать владельца» (artist_without_owner, participantsWithoutOwner, P11): an existing owner, or a new one created
 * here. A 409 `possible_duplicate` of the new owner opens the duplicate dialog: «тот же» assigns that owner, «новый»
 * creates with `force: true` and assigns it.
 */
export function AssignOwnerDialog(props: { artistId: string; pseudonym: string; onClose: () => void }) {
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  const [owner, setOwner] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'person' | 'label'>('person');
  const [similar, setSimilar] = useState<Similar | null>(null);
  const run = useAction(
    async (args: { force: boolean; existing?: string }) => {
      const ownerId =
        args.existing ?? (mode === 'create' ? (await api.owners.create({ name: name.trim(), kind, force: args.force || undefined })).id : owner);
      if (!ownerId) throw new api.ApiError(a.hints.fillFields, 0, 'validation_error');
      return api.artists.assignOwner(props.artistId, { ownerId });
    },
    { invalidate: 'all', success: (x) => fmt(a.toast.ownerAssigned, { pseudonym: x.pseudonym }) },
  );
  const submit = (args: { force: boolean; existing?: string }) =>
    run.mutate(args, {
      onSuccess: props.onClose,
      onError: (e) => {
        const found = similarOf(e);
        if (found) setSimilar(found);
      },
    });
  if (similar) {
    const t = ru.money.create;
    return (
      <DuplicateDialog
        title={t.duplicateTitle}
        text={t.duplicateText}
        matchedBy={t.matchedBy}
        same={t.same}
        fresh={t.fresh}
        similar={similar}
        pending={run.isPending}
        onSame={(id) => submit({ force: false, existing: id })}
        onFresh={() => submit({ force: true })}
        onClose={props.onClose}
      />
    );
  }
  const ready = mode === 'pick' ? owner !== null : name.trim() !== '';
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={a.assignOwner}
      subtitle={ru.reasonActions.artist_without_owner}
      footer={
        <ActionButton
          name="assign-submit"
          isDisabled={!ready}
          reason={ready ? undefined : a.hints.fillFields}
          isPending={run.isPending}
          onPress={() => submit({ force: false })}
        >
          {a.assignOwner}
        </ActionButton>
      }
    >
      <div className="text-sm">
        {f.artist}: <b>{props.pseudonym}</b>
      </div>
      <SelectField
        name="assign-mode"
        label={f.owner}
        value={mode}
        onChange={(v) => setMode(v === 'create' ? 'create' : 'pick')}
        options={[
          { id: 'pick', label: f.pickExisting },
          { id: 'create', label: a.steps.createOwner },
        ]}
      />
      {mode === 'pick' ? (
        <EntityPicker name="assign-owner" label={f.owner} kind="owners" value={owner} onChange={(id) => setOwner(id)} />
      ) : (
        <>
          <TextField name="owner-name" label={f.ownerName} value={name} onChange={setName} isRequired />
          <SelectField
            name="owner-kind"
            label={f.ownerKind}
            value={kind}
            onChange={(v) => setKind(v === 'label' ? 'label' : 'person')}
            options={[
              { id: 'person', label: f.person },
              { id: 'label', label: f.label },
            ]}
          />
        </>
      )}
    </FormDialog>
  );
}
