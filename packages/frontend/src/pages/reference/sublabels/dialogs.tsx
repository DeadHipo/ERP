import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { sublabelTermListItemSchema, sublabelTermsResultSchema } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { sublabelQueries } from '../../../api/queries/sublabels';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';

const t = ru.sublabels;
export type Term = z.output<typeof sublabelTermListItemSchema>;
type Preview = z.output<typeof sublabelTermsResultSchema>;

/** «Завести саблейбл» / «Переименовать»: a name only, unique in the organization without case. */
export function NameDialog(props: { sublabel?: { id: string; name: string }; onClose: () => void }) {
  const [name, setName] = useState(props.sublabel?.name ?? '');
  const editing = props.sublabel !== undefined;
  const run = useAction(
    () => (props.sublabel ? api.sublabels.rename(props.sublabel.id, name.trim()) : api.sublabels.create(name.trim())),
    { invalidate: 'reference', success: (r) => fmt(editing ? t.renamed : t.created, { name: r.name }) },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => (open ? null : props.onClose())}
      title={editing ? t.renameTitle : t.createTitle}
      footer={
        <ActionButton
          name="sublabel-name-submit"
          op={editing ? 'PATCH /sublabels/:id' : 'POST /sublabels'}
          isPending={run.isPending}
          isDisabled={name.trim() === ''}
          reason={t.nameNeeded}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {t.save}
        </ActionButton>
      }
    >
      <TextField name="sublabel-name" label={t.name} value={name} onChange={setName} />
    </FormDialog>
  );
}

const ISRC_SPLIT = /[\s,]+/;

/** The pasted text: one ISRC per line or separated by commas; a line «ISRC;percent;month» overrides the batch. */
export function parseItems(text: string) {
  const items: { isrc: string; percent?: string; validFrom?: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.includes(';')) {
      const [isrc = '', percent = '', from = ''] = line.split(';').map((x) => x.trim());
      if (isrc !== '') items.push({ isrc, ...(percent ? { percent } : {}), ...(from ? { validFrom: from } : {}) });
      continue;
    }
    for (const isrc of line.split(ISRC_SPLIT)) if (isrc.trim() !== '') items.push({ isrc: isrc.trim() });
  }
  return items;
}

/** «Добавить треки» (D-218): «Проверить» = the preview (nothing written), «Сохранить» = the same batch, all or nothing. */
export function AddTermsDialog(props: { sublabelId?: string; isrcs?: string[]; month?: string; onClose: () => void }) {
  const list = useQuery(sublabelQueries.list());
  const [sublabelId, setSublabelId] = useState(props.sublabelId ?? '');
  const [text, setText] = useState((props.isrcs ?? []).join('\n'));
  const [percent, setPercent] = useState('');
  const [from, setFrom] = useState(props.month ?? '');
  const [to, setTo] = useState('');
  const [document, setDocument] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ key: string; result: Preview } | null>(null);
  const items = parseItems(text);
  const body = { percent: percent.trim(), validFrom: from, validTo: to === '' ? null : to, documentId: document, items };
  const key = JSON.stringify([sublabelId, body]);
  const ready = sublabelId !== '' && items.length > 0 && percent.trim() !== '' && from !== '';
  const check = useAction(() => api.sublabels.addTerms(sublabelId, body, true), { invalidate: 'reference' });
  const save = useAction(() => api.sublabels.addTerms(sublabelId, body, false), {
    invalidate: 'all',
    success: (r) => fmt(t.saved, { n: r.termIds.length }),
  });
  const current = preview?.key === key ? preview.result : null;
  const writes = current ? current.totals.new + current.totals.closes : 0;
  const saveReason = !current ? t.previewNeeded : current.totals.errors > 0 ? t.previewErrors : writes === 0 ? t.nothingToSave : undefined;
  const name = list.data?.find((s) => s.id === sublabelId)?.name ?? '';
  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => (open ? null : props.onClose())}
      title={fmt(t.addTitle, { name })}
      subtitle={t.addHint}
      footer={
        <>
          <ActionButton
            name="sublabel-terms-preview"
            op="POST /sublabels/:id/terms"
            variant="secondary"
            isPending={check.isPending}
            isDisabled={!ready}
            reason={t.addNeeds}
            onPress={() => check.mutate(undefined, { onSuccess: (r) => setPreview({ key, result: r }) })}
          >
            {t.preview}
          </ActionButton>
          <ActionButton
            name="sublabel-terms-submit"
            op="POST /sublabels/:id/terms"
            isPending={save.isPending}
            isDisabled={saveReason !== undefined}
            reason={saveReason}
            onPress={() => save.mutate(undefined, { onSuccess: props.onClose })}
          >
            {t.save}
          </ActionButton>
        </>
      }
    >
      {props.sublabelId === undefined ? (
        <label className="flex flex-col gap-1 text-sm">
          {t.cols.sublabel}
          <select
            data-testid="field-sublabel-terms-sublabel"
            className="rounded-lg border border-border bg-transparent p-2"
            value={sublabelId}
            onChange={(e) => setSublabelId(e.target.value)}
          >
            <option value="">—</option>
            {(list.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        {t.isrcs}
        <textarea
          data-testid="field-sublabel-terms-isrcs"
          className="min-h-32 rounded-lg border border-border bg-transparent p-2 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'QZTST2600001\nQZTST2600002;25;2026-06'}
        />
      </label>
      <TextField name="sublabel-terms-percent" label={t.percent} value={percent} onChange={setPercent} placeholder="50" />
      <TextField name="sublabel-terms-from" label={t.from} type="month" value={from} onChange={setFrom} />
      <TextField name="sublabel-terms-to" label={t.to} type="month" value={to} onChange={setTo} />
      <EntityPicker name="sublabel-terms-document" label={t.document} kind="documents" value={document} onChange={(id) => setDocument(id)} />
      {document === null ? <p className="text-xs text-warning">{t.noDocumentWarning}</p> : null}
      {current ? <PreviewTable result={current} /> : null}
    </FormDialog>
  );
}

function PreviewTable(props: { result: Preview }) {
  const r = props.result;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm" data-testid="terms-preview-totals" data-errors={r.totals.errors} data-new={r.totals.new} data-closes={r.totals.closes}>
        {fmt(t.totals, { rows: r.totals.rows, new: r.totals.new, closes: r.totals.closes, unchanged: r.totals.unchanged, errors: r.totals.errors })}
      </p>
      <SimpleTable testId="terms-preview" headers={[t.cols.line, t.cols.isrc, t.cols.title, t.cols.percent, t.cols.from, t.cols.kind]}>
        {r.rows.map((x) => (
          <tr key={x.line} data-testid={`terms-preview-row-${x.line}`} data-kind={x.kind}>
            <Td>{x.line}</Td>
            <Td>{x.isrc}</Td>
            <Td>{x.title ?? <span className="text-muted">{t.notInCatalog}</span>}</Td>
            <Td>{x.percent ? `${x.percent}%` : ''}</Td>
            <Td>{x.validFrom ?? ''}</Td>
            <Td className={x.kind === 'error' ? 'text-danger' : ''}>
              {x.kind === 'error' && x.error ? t.rowError[x.error] : t.kind[x.kind]}
              {x.closes ? ` · ${fmt(t.closesText, { name: x.closes.sublabelName, percent: x.closes.percent, from: x.closes.validFrom })}` : ''}
            </Td>
          </tr>
        ))}
      </SimpleTable>
    </div>
  );
}

/** «История» of one track: every term (the cancelled too), the close of the open one and the cancel of the latest. */
export function TrackTermsDialog(props: { isrc: string; onClose: () => void }) {
  const history = useQuery(sublabelQueries.terms({ isrc: props.isrc, withCancelled: true }));
  const [closeMonth, setCloseMonth] = useState('');
  const [reason, setReason] = useState('');
  const terms = history.data ?? [];
  const live = terms.filter((x) => x.cancelledAt === null);
  const last = live.reduce<Term | null>((a, x) => (a === null || x.validFrom > a.validFrom ? x : a), null);
  const open = live.find((x) => x.validTo === null) ?? null;
  const close = useAction((id: string) => api.sublabels.closeTerm(id, closeMonth), {
    invalidate: 'all',
    success: (r) => fmt(t.closed, { month: r.validTo ?? '' }),
  });
  const cancel = useAction((id: string) => api.sublabels.cancelTerm(id, reason.trim()), { invalidate: 'all', success: () => t.cancelled });
  return (
    <FormDialog isOpen onOpenChange={(o) => (o ? null : props.onClose())} title={fmt(t.historyTitle, { isrc: props.isrc })}>
      <SimpleTable testId="sublabel-term-history" headers={[t.cols.sublabel, t.cols.percent, t.cols.from, t.cols.to, t.cols.document, t.cols.state]}>
        {terms.map((x) => (
          <tr key={x.id} data-testid={`history-${x.id}`} data-state={x.state}>
            <Td>{x.sublabelName}</Td>
            <Td>{x.percent}%</Td>
            <Td>{x.validFrom}</Td>
            <Td>{x.validTo ?? t.openEnded}</Td>
            <Td>{x.documentStatus ? t.documentStatus[x.documentStatus] : t.noDocument}</Td>
            <Td>{t.state[x.state]}</Td>
          </tr>
        ))}
      </SimpleTable>
      {open ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <TextField name="term-close-month" label={t.closeMonth} type="month" value={closeMonth} onChange={setCloseMonth} />
          <ActionButton
            name="close-sublabel-term"
            op="POST /sublabels/terms/:id/close"
            variant="secondary"
            isPending={close.isPending}
            isDisabled={closeMonth === ''}
            reason={t.closeMonth}
            onPress={() => close.mutate(open.id, { onSuccess: props.onClose })}
          >
            {t.close}
          </ActionButton>
        </div>
      ) : null}
      {last ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
          <p className="text-xs text-muted">{t.cancelHint}</p>
          <TextField name="term-cancel-reason" label={t.cancelReason} value={reason} onChange={setReason} />
          <ActionButton
            name="cancel-sublabel-term"
            op="POST /sublabels/terms/:id/cancel"
            variant="danger"
            isPending={cancel.isPending}
            isDisabled={reason.trim() === ''}
            reason={t.cancelReason}
            onPress={() => cancel.mutate(last.id, { onSuccess: props.onClose })}
          >
            {t.cancel} {last.sublabelName} {last.percent}% {last.validFrom}
          </ActionButton>
        </div>
      ) : null}
    </FormDialog>
  );
}

/** «Приложить документ»: one document to the chosen live terms without one. */
export function AttachDialog(props: { terms: Term[]; onClose: () => void }) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(props.terms.map((x) => x.id)));
  const [document, setDocument] = useState<string | null>(null);
  const run = useAction(() => api.sublabels.attachDocument([...chosen], document ?? ''), {
    invalidate: 'all',
    success: (r) => fmt(t.attached, { n: r.length }),
  });
  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.attachTitle}
      subtitle={fmt(t.attachCount, { n: chosen.size })}
      footer={
        <ActionButton
          name="attach-sublabel-document"
          op="POST /sublabels/terms/document"
          isPending={run.isPending}
          isDisabled={chosen.size === 0 || document === null}
          reason={chosen.size === 0 ? t.selectFirst : t.document}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {t.attach}
        </ActionButton>
      }
    >
      <EntityPicker name="attach-document" label={t.document} kind="documents" value={document} onChange={(id) => setDocument(id)} />
      <SimpleTable testId="attach-terms" headers={['', t.cols.isrc, t.cols.title, t.cols.sublabel, t.cols.percent, t.cols.from]}>
        {props.terms.map((x) => (
          <tr key={x.id}>
            <Td>
              <input type="checkbox" data-testid={`attach-${x.id}`} checked={chosen.has(x.id)} onChange={() => toggle(x.id)} />
            </Td>
            <Td>{x.isrc}</Td>
            <Td>{x.title ?? ''}</Td>
            <Td>{x.sublabelName}</Td>
            <Td>{x.percent}%</Td>
            <Td>{x.validFrom}</Td>
          </tr>
        ))}
      </SimpleTable>
    </FormDialog>
  );
}
