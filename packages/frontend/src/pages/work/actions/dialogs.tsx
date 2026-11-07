import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { fundedFrom as fundedFromSchema, participationBase } from '@erp/shared/api-schemas';
import type { ParticipationListItem } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import type { OperationKey } from '../../../api/coverage';
import { useAction } from '../../../api/queries/core';
import { documentQueries } from '../../../api/queries/documents';
import { labelQueries } from '../../../api/queries/labels';
import { usePublishingV2 } from '../../../api/queries/auth';
import { ownerQueries } from '../../../api/queries/owners';
import { publishingQueries, publishingV2Queries } from '../../../api/queries/publishing';
import { ChooseOwnerDialog } from '../../reference/publishing-v2/LinksTab';
import { TermDialog } from '../../reference/publishing-v2/TermDialog';
import { splitQueries } from '../../../api/queries/splits';
import { trackQueries } from '../../../api/queries/tracks';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { DateField } from '../../../components/fields/DateField';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { useOperator } from '../../../lib/operator';
import { fmt, ru } from '../../../i18n/ru';
import { DocumentStep, type ReadyDocument } from './DocumentStep';
import { useApproveLines } from './approve-lines';
import { SPLIT_STEP_KINDS } from '../../../lib/document-kinds';

// The dialogs of the queue and signal actions (16 §2.6, §2.7; 17 §6). Each is opened by the page for one row and
// closed by `onClose` after its final write succeeded. Irreversible final steps go through `ConfirmDialog`. The owner
// actions live in `owner-dialogs.tsx`, the label rule close in `rule-dialogs.tsx` and the ad edit of a signal row in
// `pages/ads/AdDialogs.tsx` (`EditAdByIdDialog`, D-169); this file re-exports them so the
// action table (`action-table.ts`) names every dialog from one module.

export { AssignOwnerDialog, CreateContractDialog, MergeOwnerDialog } from './owner-dialogs';
export { CloseRuleDialog } from './rule-dialogs';
export { SetOperationLabelDialog } from './label-dialogs';
export { EditAdByIdDialog } from '../../ads/AdDialogs';
export { TrackLabelsDialog } from '../../catalog/track/TrackLabelsDialog';

const a = ru.actions;
const f = a.fields;
type Base = z.output<typeof participationBase>;
type Funded = z.output<typeof fundedFromSchema>;

/** `YYYY-MM` -> the first day of that month (the backend floors every rule date to it anyway, M52). */
const monthStart = (month: string) => (month.length === 7 ? `${month}-01` : month);
const period = (from: string, to: string | null) => `${from} → ${to ?? 'бессрочно'}`;
/** «от нетто, из доли артиста» of a participation, in Russian. */
const participationText = (p: { base: Base; fundedFrom: Funded }) =>
  `${ru.catalog.rules.bases[p.base]}, ${ru.signalsPage.funded[p.fundedFrom]}`;

function Submit(props: { name?: string; op: OperationKey; label: string; disabled: boolean; pending: boolean; onPress: () => void; reason?: string }) {
  return (
    <ActionButton
      name={props.name ?? 'submit'}
      op={props.op}
      isPending={props.pending}
      isDisabled={props.disabled}
      reason={props.disabled ? (props.reason ?? a.hints.fillFields) : undefined}
      onPress={props.onPress}
    >
      {props.label}
    </ActionButton>
  );
}

// ---- split_unconfirmed ----

export function ConfirmSplitDialog(props: { splitId: string; isrc: string; onClose: () => void }) {
  const list = useQuery(splitQueries.list(props.isrc));
  const split = list.data?.items.find((s) => s.id === props.splitId);
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [confirm, setConfirm] = useState(false);
  const run = useAction((documentId: string) => api.splits.confirm(props.splitId, { documentId }), {
    invalidate: 'all',
    success: (s) => fmt(a.toast.splitConfirmed, { isrc: s.isrc }),
  });
  const rows = split ? split.shares.map((s) => `${s.pseudonym} ${s.percent} %`).join(', ') : '';
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={a.confirmSplit}
        subtitle={ru.reasonActions.split_unconfirmed}
        footer={<Submit op="POST /splits/:id/confirm" label={a.confirmSplit} reason={a.hints.pickFirst} disabled={!doc || !split} pending={run.isPending} onPress={() => setConfirm(true)} />}
      >
        <div className="text-sm">
          ISRC <b>{props.isrc}</b> · {rows} {split ? `· ${period(split.validFrom, split.validTo)}` : ''}
        </div>
        <DocumentStep kinds={SPLIT_STEP_KINDS} defaultTitle={`Приложение ${props.isrc}`} ready={doc} onReady={setDoc} />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={a.confirm.confirmSplitTitle}
        lines={[...a.confirm.confirmSplitLines(props.isrc, rows, split ? period(split.validFrom, split.validTo) : '', doc?.title ?? '')]}
        isPending={run.isPending}
        onConfirm={() => doc && run.mutate(doc.id, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}

// ---- assumption / rule_unconfirmed: replace the document of a split row, a participation or a label rule ----

export function ReplaceDocumentDialog(props: {
  kind: 'split' | 'participation' | 'labelRule';
  /** The split, participation or label rule id. */
  ruleId: string;
  isrc: string | null;
  /** The document being replaced (the assumption or the unapproved one). */
  oldDocumentId: string | null;
  fromMonth: string;
  title: string;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [month, setMonth] = useState(props.fromMonth);
  const [confirm, setConfirm] = useState(false);
  const splits = useQuery({ ...splitQueries.list(props.isrc ?? undefined), enabled: props.kind === 'split' });
  const parts = useQuery({ ...splitQueries.participations(props.isrc ?? undefined), enabled: props.kind === 'participation' });
  const labels = useQuery({ ...labelQueries.list(), enabled: props.kind === 'labelRule' });
  const split = splits.data?.items.find((s) => s.id === props.ruleId);
  const part = parts.data?.items.find((p) => p.id === props.ruleId);
  const label = labels.data?.find((l) => l.rules.some((r) => r.id === props.ruleId));
  const rule = label?.rules.find((r) => r.id === props.ruleId);
  const found = props.kind === 'split' ? !!split : props.kind === 'participation' ? !!part : !!rule;
  const from = monthStart(month);

  // The new rows of a split change end where the next split of the ISRC starts (19 §4): read from the splits list.
  const next = (splits.data?.items ?? [])
    .filter((s) => s.validFrom > from)
    .map((s) => s.validFrom)
    .sort()[0];
  const what =
    props.kind === 'split' && split
      ? split.shares.map((s) => `${s.pseudonym} ${s.percent} %${s.documentId === props.oldDocumentId ? ' [допущение]' : ''}`).join(', ')
      : props.kind === 'participation' && part
        ? `${part.pseudonym} ${part.percent} % (${participationText(part)}) · ${part.isrc}`
        : rule && label
          ? `${label.name} → ${rule.recipientPseudonym} ${rule.percent} %`
          : '';

  const run = useAction(
    async (documentId: string): Promise<string> => {
      if (props.kind === 'split' && split) {
        const swap = (d: string | null) => (d !== null && d === props.oldDocumentId ? documentId : d);
        const res = await api.splits.change({
          isrc: split.isrc,
          from,
          shares: split.shares.map((s) => ({ artistId: s.artistId, percent: s.percent, documentId: swap(s.documentId) })),
          documentId: split.documentId && split.documentId !== props.oldDocumentId ? split.documentId : documentId,
        });
        return fmt(a.toast.splitChanged, { isrc: res.isrc, from: res.validFrom });
      }
      if (props.kind === 'participation' && part) {
        await api.participations.close(part.id, { validTo: from });
        const res = await api.participations.create({
          isrc: part.isrc,
          artistId: part.artistId,
          percent: part.percent,
          base: part.base,
          fundedFrom: part.fundedFrom,
          fromArtistId: part.fromArtistId,
          validFrom: from,
          validTo: part.validTo,
          documentId,
          note: part.note,
        });
        return fmt(a.toast.participationCreated, { from: res.validFrom });
      }
      if (rule && label) {
        await api.labels.closeRule(rule.id, { validTo: from });
        const res = await api.labels.setRule(label.id, {
          percent: rule.percent,
          recipientArtistId: rule.recipientArtistId,
          validFrom: from,
          validTo: rule.validTo,
          documentId,
          note: rule.note,
        });
        return fmt(a.toast.ruleSet, { from: res.validFrom });
      }
      throw new api.ApiError(a.hints.noRule, 0, 'not_found');
    },
    { invalidate: 'all', success: (text) => text },
  );

  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={props.title}
        subtitle={a.hints.monthRule}
        footer={
          <Submit
            op={props.kind === 'split' ? 'POST /splits/change' : props.kind === 'participation' ? 'POST /participations/:id/close' : 'POST /labels/:id/rules'}
            label={props.title}
            disabled={!doc || !found || month === ''}
            reason={!found ? a.hints.noRule : a.hints.pickFirst}
            pending={run.isPending}
            onPress={() => setConfirm(true)}
          />
        }
      >
        <div className="text-sm" data-testid="replace-what">
          {what}
        </div>
        <DateField name="replace-from" label={f.from} value={month} onChange={setMonth} month isRequired />
        <DocumentStep
          kinds={SPLIT_STEP_KINDS}
          defaultTitle={`Документ ${props.isrc ?? ''}`.trim()}
          ready={doc}
          onReady={setDoc}
        />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={props.kind === 'split' ? a.confirm.changeTitle : a.confirm.closeRecreateTitle}
        lines={
          props.kind === 'split'
            ? [
                ...a.confirm.changeLines(props.isrc ?? '', from, what.replace(/ \[допущение\]/g, ''), doc?.title ?? ''),
                next ? fmt(a.confirm.changeUntil, { to: next }) : a.confirm.changeOpen,
              ]
            : [...a.confirm.closeRecreateLines(what, from, doc?.title ?? '')]
        }
        isPending={run.isPending}
        onConfirm={() => doc && run.mutate(doc.id, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}

/**
 * «Утвердить документ» (rule_unconfirmed, P13, P14, P10 Документы): the confirmation alone. Its lines come from
 * `GET /documents/:id/uses` (`useApproveLines`); OK stays disabled until that answers. `doc` saves the documents list
 * when the caller already has the document.
 */
export function ApproveDocumentDialog(props: {
  documentId: string;
  doc?: { id: string; title: string; kind: string };
  onClose: () => void;
}) {
  const { operator } = useOperator();
  const docs = useQuery({ ...documentQueries.list(), enabled: props.doc === undefined });
  const doc = props.doc ?? docs.data?.find((d) => d.id === props.documentId);
  const approve = useApproveLines(doc ?? null, true);
  const run = useAction(() => api.documents.approve(props.documentId, { by: operator }), {
    invalidate: 'all',
    success: (d) => fmt(a.toast.approved, { title: d.title }),
  });
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={a.confirm.approveTitle}
      lines={approve.lines}
      isLoading={approve.loading || doc === undefined}
      isPending={run.isPending}
      onConfirm={() => run.mutate(undefined, { onSettled: props.onClose })}
    />
  );
}

// ---- label_unmapped, labelUnmapped ----

export function LabelAliasDialog(props: { alias: string; onClose: () => void }) {
  const labels = useQuery(labelQueries.list());
  const own = (labels.data ?? []).filter((l) => l.kind === 'own');
  const [labelId, setLabelId] = useState<string | null>(null);
  const run = useAction((id: string) => api.labels.addAlias(id, { alias: props.alias }), {
    invalidate: 'all',
    success: (l) => fmt(a.toast.aliasAdded, { alias: props.alias, label: l.name }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={a.labelAlias}
      subtitle={ru.reasonActions.label_unmapped}
      footer={
        <Submit name="alias-submit" op="POST /labels/:id/aliases" label={a.labelAlias} disabled={!labelId} pending={run.isPending} onPress={() => labelId && run.mutate(labelId, { onSuccess: props.onClose })} />
      }
    >
      <div className="text-sm">
        {ru.signalsPage.cols.label}: <b>{props.alias}</b>
      </div>
      <SelectField name="alias-label" label={f.ownLabel} value={labelId} onChange={setLabelId} options={own.map((l) => ({ id: l.id, label: l.name }))} />
    </FormDialog>
  );
}

function RuleFields(props: {
  percent: string;
  setPercent: (v: string) => void;
  recipient: string | null;
  setRecipient: (v: string | null) => void;
  month: string;
  setMonth: (v: string) => void;
  document: string | null;
  setDocument: (v: string | null) => void;
}) {
  return (
    <>
      <TextField name="rule-percent" label={f.percent} value={props.percent} onChange={props.setPercent} isRequired />
      <EntityPicker name="rule-recipient" label={f.recipient} kind="artists" value={props.recipient} onChange={(id) => props.setRecipient(id)} />
      <DateField name="rule-from" label={f.validFrom} value={props.month} onChange={props.setMonth} month isRequired />
      <EntityPicker
        name="rule-document"
        label={f.document}
        kind="documents"
        value={props.document}
        accept={(i) => i.kind !== 'assumption'}
        onChange={(id) => props.setDocument(id)}
      />
    </>
  );
}

export function SublabelRuleDialog(props: { labelString: string; onClose: () => void }) {
  const labels = useQuery(labelQueries.list());
  const own = (labels.data ?? []).filter((l) => l.kind === 'own');
  const [ownId, setOwnId] = useState<string | null>(null);
  const [name, setName] = useState(props.labelString);
  const [percent, setPercent] = useState('50');
  const [recipient, setRecipient] = useState<string | null>(null);
  const [month, setMonth] = useState('');
  const [document, setDocument] = useState<string | null>(null);
  const run = useAction(
    async () => {
      if (!ownId || !recipient) throw new api.ApiError(a.hints.fillFields, 0, 'validation_error');
      const label = await api.labels.create({ name: name.trim(), kind: 'sublabel', ownLabelId: ownId });
      await api.labels.addAlias(label.id, { alias: props.labelString });
      const rule = await api.labels.setRule(label.id, {
        percent: percent.trim(),
        recipientArtistId: recipient,
        validFrom: monthStart(month),
        documentId: document,
      });
      return `${fmt(a.toast.labelCreated, { name: label.name })}; ${fmt(a.toast.ruleSet, { from: rule.validFrom })}`;
    },
    { invalidate: 'all', success: (t) => t },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={a.sublabelRule}
      subtitle={a.hints.monthRule}
      footer={
        <Submit
          name="sublabel-submit" op="POST /labels"
          label={a.sublabelRule}
          disabled={!ownId || !recipient || name.trim() === '' || percent.trim() === '' || month === ''}
          pending={run.isPending}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        />
      }
    >
      <SelectField name="sublabel-own" label={f.ownLabel} value={ownId} onChange={setOwnId} options={own.map((l) => ({ id: l.id, label: l.name }))} />
      <TextField name="sublabel-name" label={f.labelName} value={name} onChange={setName} isRequired />
      <RuleFields {...{ percent, setPercent, recipient, setRecipient, month, setMonth, document, setDocument }} />
    </FormDialog>
  );
}

/** sublabelWithoutRule: a rule for an existing sublabel (found by its name or alias in `GET /labels`). */
export function SetRuleDialog(props: { labelString: string; month: string; onClose: () => void }) {
  const labels = useQuery(labelQueries.list());
  const label = labels.data?.find((l) => l.name === props.labelString || l.aliases.includes(props.labelString));
  const [percent, setPercent] = useState('50');
  const [recipient, setRecipient] = useState<string | null>(null);
  const [month, setMonth] = useState(props.month);
  const [document, setDocument] = useState<string | null>(null);
  const run = useAction(
    (labelId: string) =>
      api.labels.setRule(labelId, {
        percent: percent.trim(),
        recipientArtistId: recipient ?? '',
        validFrom: monthStart(month),
        documentId: document,
      }),
    { invalidate: 'all', success: (r) => fmt(a.toast.ruleSet, { from: r.validFrom }) },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={a.setRule}
      subtitle={a.hints.monthRule}
      footer={
        <Submit
          name="rule-submit" op="POST /labels/:id/rules"
          label={a.setRule}
          disabled={!label || !recipient || percent.trim() === '' || month === ''}
          reason={!label ? a.hints.noRule : undefined}
          pending={run.isPending}
          onPress={() => label && run.mutate(label.id, { onSuccess: props.onClose })}
        />
      }
    >
      <div className="text-sm">
        {ru.signalsPage.cols.label}: <b>{props.labelString}</b>
      </div>
      <RuleFields {...{ percent, setPercent, recipient, setRecipient, month, setMonth, document, setDocument }} />
    </FormDialog>
  );
}

// ---- unknown_pair, unallocated ----

export function RegisterTrackDialog(props: { isrc: string; upc: string; title?: string; onClose: () => void }) {
  const [title, setTitle] = useState(props.title ?? props.isrc);
  const [isrc, setIsrc] = useState(props.isrc);
  const [upc, setUpc] = useState(props.upc);
  const run = useAction(() => api.tracks.create({ title: title.trim(), isrc: isrc.trim(), upc: upc.trim() || null }), {
    invalidate: 'all',
    success: (t) => fmt(a.toast.trackCreated, { isrc: t.isrc ?? '' }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={a.registerTrack}
      subtitle={ru.reasonActions.unknown_pair}
      footer={
        <Submit
          name="track-submit" op="POST /tracks"
          label={a.registerTrack}
          disabled={title.trim() === '' || isrc.trim() === ''}
          pending={run.isPending}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        />
      }
    >
      <TextField name="track-title" label={f.trackTitle} value={title} onChange={setTitle} isRequired />
      <TextField name="track-isrc" label={f.isrc} value={isrc} onChange={setIsrc} isRequired />
      <TextField name="track-upc" label={f.upc} value={upc} onChange={setUpc} />
    </FormDialog>
  );
}

// ---- writer_unmapped, ambiguousWriters ----

/** D-194: under publishing v2 the songwriter is linked on its v2 dialog; the old map refuses writes. */
export function MapWriterDialog(props: { writer: string; onClose: () => void }) {
  return usePublishingV2() ? <LinkSongwriterDialog {...props} /> : <MapWriterDialogV1 {...props} />;
}

/** The queue names the songwriter of v2 by its name (unique per organization): its row of the links, then «Владелец автора». */
function LinkSongwriterDialog(props: { writer: string; onClose: () => void }) {
  const links = useQuery(publishingV2Queries.links(''));
  const row = links.data?.find((x) => x.songwriterId === props.writer || x.name === props.writer);
  if (row) return <ChooseOwnerDialog row={row} onClose={props.onClose} />;
  return (
    <FormDialog isOpen onOpenChange={(o) => (o ? null : props.onClose())} title={a.mapWriter} subtitle={ru.reasonActions.writer_unmapped}>
      <div className="text-sm" data-testid="songwriter-v2-missing">
        {links.data ? fmt(a.hints.noSongwriterV2, { name: props.writer }) : ru.common.loading}
      </div>
    </FormDialog>
  );
}

function MapWriterDialogV1(props: { writer: string; onClose: () => void }) {
  const writers = useQuery(publishingQueries.writers());
  const w = writers.data?.find((x) => x.writerNorm === props.writer || x.displayName === props.writer);
  const [owner, setOwner] = useState<string | null>(null);
  const run = useAction(
    async (norm: string) => {
      await api.publishing.mapWriter(norm, { ownerId: owner });
      return api.publishing.resolveWriters();
    },
    { invalidate: 'all', success: (r) => fmt(a.toast.writerMapped, { matched: r.matched, created: r.created, ambiguous: r.ambiguous }) },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={a.mapWriter}
      subtitle={ru.reasonActions.writer_unmapped}
      footer={
        <Submit
          name="writer-submit" op="POST /publishing/writers/:norm/map"
          label={a.mapWriter}
          disabled={!w || !owner}
          reason={!w && writers.data ? a.hints.noWriter : undefined}
          pending={run.isPending}
          onPress={() => w && run.mutate(w.writerNorm, { onSuccess: props.onClose })}
        />
      }
    >
      <div className="text-sm">
        {ru.signalsPage.cols.writer}: <b>{w?.displayName ?? props.writer}</b>
      </div>
      <EntityPicker name="writer-owner" label={f.owner} kind="owners" value={owner} onChange={(id) => setOwner(id)} />
    </FormDialog>
  );
}

// ---- publishing_terms_unconfirmed ----

/** D-194: under publishing v2 the percent is a term of `links` (no operation type); the old terms refuse writes. */
export function PublishingTermsDialog(props: { ownerId: string; ownerLabel: string; onClose: () => void }) {
  return usePublishingV2() ? <OwnerTermV2Dialog {...props} /> : <PublishingTermsDialogV1 {...props} />;
}

function OwnerTermV2Dialog(props: { ownerId: string; ownerLabel: string; onClose: () => void }) {
  const detail = useQuery(ownerQueries.detail(props.ownerId));
  return <TermDialog ownerId={props.ownerId} ownerName={props.ownerLabel} terms={detail.data?.publishingTerms ?? []} onClose={props.onClose} />;
}

function PublishingTermsDialogV1(props: { ownerId: string; ownerLabel: string; onClose: () => void }) {
  const [percent, setPercent] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [operationType, setOperationType] = useState('');
  const [document, setDocument] = useState<string | null>(null);
  const run = useAction(
    () =>
      api.publishing.setTerms({
        ownerId: props.ownerId,
        percent: percent.trim(),
        validFrom,
        documentId: document,
        ...(operationType.trim() ? { operationType: operationType.trim() } : {}),
      }),
    { invalidate: 'all', success: (t) => fmt(a.toast.termsSet, { percent: t.percent, from: t.validFrom }) },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={a.publishingTerms}
      subtitle={ru.reasonActions.publishing_terms_unconfirmed}
      footer={
        <Submit
          name="terms-submit" op="POST /publishing/terms"
          label={a.publishingTerms}
          disabled={percent.trim() === '' || validFrom === ''}
          pending={run.isPending}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        />
      }
    >
      <div className="text-sm">
        {f.owner}: <b>{props.ownerLabel}</b>
      </div>
      <TextField name="terms-percent" label={f.percent} value={percent} onChange={setPercent} isRequired />
      <DateField name="terms-from" label={f.validFrom} value={validFrom} onChange={setValidFrom} isRequired />
      <TextField name="terms-operation" label={f.operationType} value={operationType} onChange={setOperationType} />
      <EntityPicker
        name="terms-document"
        label={f.document}
        kind="documents"
        value={document}
        accept={(i) => i.status === 'approved' && i.kind !== 'assumption'}
        onChange={(id) => setDocument(id)}
      />
    </FormDialog>
  );
}

// ---- isrcsWithoutSplit ----

export function CreateSplitDialog(props: { isrc: string; onClose: () => void }) {
  const [rows, setRows] = useState<{ key: string; artistId: string | null; percent: string }[]>([{ key: 'r0', artistId: null, percent: '' }]);
  const [validFrom, setValidFrom] = useState('');
  const [document, setDocument] = useState<string | null>(null);
  const run = useAction(
    () =>
      api.splits.create({
        isrc: props.isrc,
        validFrom,
        shares: rows.map((r) => ({ artistId: r.artistId ?? '', percent: r.percent.trim() })),
        documentId: document,
      }),
    { invalidate: 'all', success: (s) => fmt(a.toast.splitCreated, { isrc: s.isrc, from: s.validFrom }) },
  );
  const ready = validFrom !== '' && rows.every((r) => r.artistId && r.percent.trim() !== '');
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={a.createSplit}
      subtitle={a.hints.monthRule}
      footer={<Submit name="split-submit" op="POST /splits" label={a.createSplit} disabled={!ready} pending={run.isPending} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })} />}
    >
      <div className="text-sm">
        ISRC <b>{props.isrc}</b>
      </div>
      {rows.map((r, i) => (
        <div key={r.key} className="grid grid-cols-[1fr_8rem] items-end gap-2">
          <EntityPicker
            name={`split-artist-${i}`}
            label={f.artist}
            kind="artists"
            value={r.artistId}
            onChange={(id) => setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, artistId: id } : x)))}
          />
          <TextField
            name={`split-percent-${i}`}
            label={f.percent}
            value={r.percent}
            onChange={(v) => setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, percent: v } : x)))}
          />
        </div>
      ))}
      <div>
        <ActionButton
          name="split-add-row"
          write={false}
          variant="secondary"
          onPress={() => setRows((xs) => [...xs, { key: `r${xs.length}`, artistId: null, percent: '' }])}
        >
          + строка
        </ActionButton>
      </div>
      <DateField name="split-from" label={f.validFrom} value={validFrom} onChange={setValidFrom} isRequired />
      <EntityPicker
        name="split-document"
        label={f.document}
        kind="documents"
        value={document}
        accept={(i) => i.kind !== 'assumption'}
        onChange={(id) => setDocument(id)}
      />
    </FormDialog>
  );
}

// ---- unfunded ----

const BASES: readonly Base[] = ['net', 'bucket'];
const FUNDED: readonly Funded[] = ['top', 'artist_pool', 'artist_share', 'label_share'];

export function RecreateParticipationDialog(props: { isrc: string; participationId: string; month: string; onClose: () => void }) {
  const parts = useQuery(splitQueries.participations(props.isrc));
  const part = parts.data?.items.find((p) => p.id === props.participationId);
  if (!part)
    return (
      <FormDialog isOpen onOpenChange={(o) => (o ? null : props.onClose())} title={a.recreateParticipation}>
        <div className="text-sm">{parts.data ? a.hints.noParticipation : ru.common.loading}</div>
      </FormDialog>
    );
  return <RecreateParticipationForm part={part} month={props.month} onClose={props.onClose} />;
}

function RecreateParticipationForm(props: {
  part: ParticipationListItem;
  month: string;
  onClose: () => void;
}) {
  const p = props.part;
  const [percent, setPercent] = useState(p.percent);
  const [base, setBase] = useState<Base>(p.base);
  const [funded, setFunded] = useState<Funded>(p.fundedFrom);
  const [month, setMonth] = useState(props.month);
  const [confirm, setConfirm] = useState(false);
  const from = monthStart(month);
  const run = useAction(
    async () => {
      const closed = await api.participations.close(p.id, { validTo: from });
      const created = await api.participations.create({
        isrc: p.isrc,
        artistId: p.artistId,
        percent: percent.trim(),
        base,
        fundedFrom: funded,
        fromArtistId: p.fromArtistId,
        validFrom: from,
        validTo: p.validTo,
        documentId: p.documentId,
        note: p.note,
      });
      return `${fmt(a.toast.participationClosed, { to: closed.validTo ?? '' })}; ${fmt(a.toast.participationCreated, { from: created.validFrom })}`;
    },
    { invalidate: 'all', success: (t) => t },
  );
  const what = `${p.pseudonym} ${p.percent} % (${participationText(p)}) · ${p.isrc} · ${period(p.validFrom, p.validTo)}`;
  // The document is named by its title (the cached documents list), never by its id.
  const docs = useQuery({ ...documentQueries.list(), enabled: p.documentId !== null });
  const docTitle = p.documentId === null ? '—' : (docs.data?.find((d) => d.id === p.documentId)?.title ?? ru.common.loading);
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={a.recreateParticipation}
        subtitle={a.hints.monthRule}
        footer={
          <Submit name="participation-submit" op="POST /participations/:id/close" label={a.recreateParticipation} disabled={percent.trim() === '' || month === ''} pending={run.isPending} onPress={() => setConfirm(true)} />
        }
      >
        <div className="text-sm">{what}</div>
        <TextField name="participation-percent" label={f.percent} value={percent} onChange={setPercent} isRequired />
        <SelectField name="participation-base" label={f.base} value={base} onChange={(v) => setBase(BASES.find((b) => b === v) ?? base)} options={BASES.map((b) => ({ id: b, label: ru.catalog.rules.bases[b] }))} />
        <SelectField
          name="participation-funded"
          label={f.fundedFrom}
          value={funded}
          onChange={(v) => setFunded(FUNDED.find((x) => x === v) ?? funded)}
          options={FUNDED.map((x) => ({ id: x, label: ru.signalsPage.funded[x] }))}
        />
        <DateField name="participation-from" label={f.closeAt} value={month} onChange={setMonth} month isRequired />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={a.confirm.closeRecreateTitle}
        lines={[...a.confirm.closeRecreateLines(what, from, docTitle)]}
        isLoading={p.documentId !== null && !docs.data}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}

// ---- tracksWithNote ----

/** Sets or clears the note of a track (M29). Without `trackId` the dialog asks for the track (by ISRC). */
export function NoteDialog(props: { trackId?: string; isrc?: string | null; note?: string; onClose: () => void }) {
  const tracks = useQuery({ ...trackQueries.list(), enabled: !props.trackId });
  const [isrc, setIsrc] = useState<string | null>(props.isrc ?? null);
  const [note, setNote] = useState(props.note ?? '');
  const trackId = props.trackId ?? tracks.data?.find((t) => t.isrc === isrc)?.id;
  const run = useAction((id: string) => api.tracks.update(id, { note: note.trim() === '' ? null : note.trim() }), {
    invalidate: 'all',
    success: (t) => (t.note ? a.toast.noteSaved : a.toast.noteCleared),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={props.trackId ? a.editNote : a.addNote}
      footer={<Submit name="note-submit" op="PATCH /tracks/:id" label={ru.common.save} disabled={!trackId} pending={run.isPending} onPress={() => trackId && run.mutate(trackId, { onSuccess: props.onClose })} />}
    >
      {props.trackId ? (
        <div className="text-sm">
          ISRC <b>{props.isrc ?? '—'}</b>
        </div>
      ) : (
        <EntityPicker name="note-track" label={f.track} kind="tracks" value={isrc} onChange={(id) => setIsrc(id)} />
      )}
      <TextField name="note-text" label={f.note} value={note} onChange={setNote} />
    </FormDialog>
  );
}
