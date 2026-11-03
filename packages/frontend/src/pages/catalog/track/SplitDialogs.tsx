import { useState } from 'react';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { DateField } from '../../../components/fields/DateField';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { DocumentStep, type ReadyDocument } from '../../work/actions/DocumentStep';
import { periodText, splitAt, type Split } from './types';

const r = ru.catalog.rules;
const f = r.fields;
const SPLIT_DOC_KINDS = ['appendix', 'contract', 'other'] as const;
const BUYOUT_DOC_KINDS = ['buyout', 'contract', 'other'] as const;

/** The stored date differs from the entered one: the backend floored it to the month start (M52). */
export const roundedNote = (entered: string, stored: string) =>
  entered !== stored ? ` (${fmt(r.toast.rounded, { date: stored })})` : '';

type Row = { key: string; artistId: string | null; label: string; percent: string; documentId: string | null; fixed: boolean };
const emptyRow = (n: number): Row => ({ key: `new${n}`, artistId: null, label: '', percent: '', documentId: null, fixed: false });
const rowsOf = (s: Split | undefined): Row[] =>
  s
    ? s.shares.map((sh) => ({
        key: sh.artistId,
        artistId: sh.artistId,
        label: sh.pseudonym,
        percent: sh.percent,
        documentId: sh.documentId,
        fixed: true,
      }))
    : [emptyRow(0)];
const rowsText = (rows: readonly Row[]) => rows.map((x) => `${x.label || '?'} ${x.percent} %`).join(', ');

/** The rows of a split: kept rows show their pseudonym (percent editable), new rows pick a pseudonym. */
function RowsEditor({ rows, setRows }: { rows: Row[]; setRows: (update: (rows: Row[]) => Row[]) => void }) {
  const [counter, setCounter] = useState(1);
  const patch = (key: string, p: Partial<Row>) => setRows((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  return (
    <div className="flex flex-col gap-2" data-testid="split-rows">
      {rows.map((row, i) => (
        <div key={row.key} className="grid grid-cols-[1fr_7rem_auto] items-end gap-2 rounded-lg border border-border p-2">
          {row.fixed ? (
            <div className="text-sm" data-testid={`split-row-${i}`}>
              {f.artist}: <b>{row.label}</b>
              {row.documentId ? (
                <span className="ml-1 inline-flex items-center gap-1 text-xs text-muted" data-testid={`split-row-document-${i}`}>
                  · {r.rowDocument}
                  <ActionButton
                    name={`split-row-drop-document-${i}`}
                    write={false}
                    variant="tertiary"
                    onPress={() => patch(row.key, { documentId: null })}
                  >
                    {f.dropDocument}
                  </ActionButton>
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <EntityPicker
                name={`split-artist-${i}`}
                label={f.artist}
                kind="artists"
                value={row.artistId}
                onChange={(id, label) => patch(row.key, { artistId: id, label })}
              />
              <EntityPicker
                name={`split-row-document-${i}`}
                label={f.rowDocument}
                kind="documents"
                value={row.documentId}
                onChange={(id) => patch(row.key, { documentId: id })}
              />
            </div>
          )}
          <TextField name={`split-percent-${i}`} label={f.percent} value={row.percent} onChange={(v) => patch(row.key, { percent: v })} />
          <ActionButton
            name={`split-remove-row-${i}`}
            write={false}
            variant="tertiary"
            onPress={() => setRows((xs) => xs.filter((x) => x.key !== row.key))}
          >
            {f.removeRow}
          </ActionButton>
        </div>
      ))}
      <div>
        <ActionButton
          name="split-add-row"
          write={false}
          variant="secondary"
          onPress={() => {
            setRows((xs) => [...xs, emptyRow(counter)]);
            setCounter((c) => c + 1);
          }}
        >
          {f.addRow}
        </ActionButton>
      </div>
    </div>
  );
}

/**
 * «Создать сплит» (`POST /splits`, no confirmation) and «Изменить сплит с месяца» (`POST /splits/change`, the rows of
 * the newest split prefilled, a document required, a confirmation saying which period closes). The dates are sent as
 * entered: the backend floors them to the month start and the toast shows the stored date.
 */
export function SplitDialog(props: { mode: 'create' | 'change'; isrc: string; splits: readonly Split[]; onClose: () => void }) {
  const change = props.mode === 'change';
  const newest = props.splits[props.splits.length - 1];
  const [rows, setRowsState] = useState<Row[]>(() => (change ? rowsOf(newest) : [emptyRow(0)]));
  const setRows = (update: (rows: Row[]) => Row[]) => setRowsState(update);
  const [from, setFrom] = useState('');
  const [note, setNote] = useState('');
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [confirm, setConfirm] = useState(false);
  const shares = rows.map((x) => ({ artistId: x.artistId ?? '', percent: x.percent.trim(), documentId: x.documentId }));
  const run = useAction(
    async () => {
      if (change) {
        const s = await api.splits.change({ isrc: props.isrc, from, shares, documentId: doc?.id ?? '', note: note.trim() || null });
        return fmt(r.toast.splitChanged, { from: s.validFrom }) + roundedNote(from, s.validFrom);
      }
      const s = await api.splits.create({ isrc: props.isrc, validFrom: from, shares, documentId: doc?.id ?? null, note: note.trim() || null });
      return fmt(r.toast.splitCreated, { from: s.validFrom }) + roundedNote(from, s.validFrom);
    },
    { invalidate: 'all', success: (text) => text },
  );
  const filled = from !== '' && rows.length > 0 && rows.every((x) => x.artistId && x.percent.trim() !== '');
  const ready = filled && (!change || doc !== null);
  const current = from ? splitAt(props.splits, from) : newest;
  const closes = current ? `${periodText(current.validFrom, current.validTo, r.open)}: ${current.shares.map((s) => `${s.pseudonym} ${s.percent} %`).join(', ')}` : '—';
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={change ? r.changeSplit : r.createSplit}
        subtitle={ru.actions.hints.monthRule}
        footer={
          <ActionButton
            name="split-submit"
            isPending={run.isPending}
            isDisabled={!ready}
            reason={!filled ? ru.actions.hints.fillFields : ru.actions.hints.pickFirst}
            onPress={() => (change ? setConfirm(true) : run.mutate(undefined, { onSuccess: props.onClose }))}
          >
            {change ? r.changeSplit : r.createSplit}
          </ActionButton>
        }
      >
        <div className="text-sm">
          ISRC <b>{props.isrc}</b>
        </div>
        <DateField name="split-from" label={change ? f.from : f.validFrom} value={from} onChange={setFrom} isRequired />
        <RowsEditor rows={rows} setRows={setRows} />
        <div className="text-sm font-medium">{change ? r.documentRequired : r.documentOptional}</div>
        <DocumentStep kinds={SPLIT_DOC_KINDS} defaultTitle={`Приложение ${props.isrc}`} ready={doc} onReady={setDoc} />
        <TextField name="split-note" label={f.note} value={note} onChange={setNote} />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={r.confirm.changeTitle}
        lines={[...r.confirm.changeLines(props.isrc, closes, from, rowsText(rows), doc?.title ?? '')]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}

/** «Выкуп» (`POST /splits/buyout` for this ISRC): the seller's share becomes 0 from the date in every affected split. */
export function BuyoutDialog(props: { isrc: string; splits: readonly Split[]; onClose: () => void }) {
  const sellers = [...new Map(props.splits.flatMap((s) => s.shares.map((sh) => [sh.artistId, sh.pseudonym] as const))).entries()];
  const [seller, setSeller] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const [confirm, setConfirm] = useState(false);
  const sellerName = sellers.find(([id]) => id === seller)?.[1] ?? '';
  const run = useAction(
    () => api.splits.buyout({ isrcs: [props.isrc], sellerArtistId: seller ?? '', effectiveFrom: from, documentId: doc?.id ?? '' }),
    {
      invalidate: 'all',
      success: (list) => {
        const first = list[0];
        if (!first) return r.toast.buyoutNone;
        return fmt(r.toast.buyout, { n: list.length, from: first.validFrom }) + roundedNote(from, first.validFrom);
      },
    },
  );
  const filled = seller !== null && from !== '';
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={r.buyout}
        subtitle={ru.actions.hints.monthRule}
        footer={
          <ActionButton
            name="buyout-submit"
            isPending={run.isPending}
            isDisabled={!filled || !doc}
            reason={!filled ? ru.actions.hints.fillFields : ru.actions.hints.pickFirst}
            onPress={() => setConfirm(true)}
          >
            {r.buyout}
          </ActionButton>
        }
      >
        <div className="text-sm">
          ISRC <b>{props.isrc}</b>
        </div>
        <SelectField
          name="buyout-seller"
          label={f.seller}
          value={seller}
          onChange={setSeller}
          options={sellers.map(([id, name]) => ({ id, label: name }))}
        />
        <DateField name="buyout-from" label={f.effectiveFrom} value={from} onChange={setFrom} isRequired />
        <DocumentStep kinds={BUYOUT_DOC_KINDS} defaultTitle={`Выкуп ${props.isrc}`} ready={doc} onReady={setDoc} />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={r.confirm.buyoutTitle}
        lines={[...r.confirm.buyoutLines(props.isrc, sellerName, from, doc?.title ?? '')]}
        isPending={run.isPending}
        onConfirm={() => run.mutate(undefined, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}
