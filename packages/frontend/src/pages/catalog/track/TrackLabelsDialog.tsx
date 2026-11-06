import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TrackLabel } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { trackQueries } from '../../../api/queries/tracks';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { QueryView } from '../../../components/PageState';
import { DateField } from '../../../components/fields/DateField';
import { LabelField, useLabelChoice } from '../../../components/fields/LabelField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../components/MoneyTable';

const t = ru.catalog.catalogLabel;

/** The open interval of the history (the label of the catalog now), or null. */
export const currentInterval = (rows: readonly TrackLabel[]): TrackLabel | null => rows.find((r) => r.validTo === null) ?? null;

/**
 * P6 «История лейбла» (D-172): the label history of an ISRC (`GET /tracks/:isrc/labels`, rows `track-label-<validFrom>`
 * with `data-source`) and the operator's correction (`POST /tracks/:isrc/label`): «Задать лейбл» opens the form
 * (`field-track-label`, `field-track-label-from`, `field-track-label-to`, `field-track-label-note`,
 * `action-set-track-label-submit`); an operator row is replaced from its own `from` (`action-replace-track-label-<validFrom>`).
 * Navigation only: no money changes. Also the action of P21 `tracksWithoutLabel`.
 */
export function TrackLabelsDialog(props: { isrc: string; onClose: () => void }) {
  const query = useQuery(trackQueries.labels(props.isrc));
  const [form, setForm] = useState<{ from: string; to: string; labelId?: string; note: string } | null>(null);
  return (
    <FormDialog isOpen onOpenChange={(o) => (o ? null : props.onClose())} title={fmt(t.title, { isrc: props.isrc })} subtitle={t.subtitle}>
      <div className="flex flex-col gap-3" data-testid="track-labels">
        <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={t.empty}>
          {(rows) => (
            <SimpleTable testId="track-labels-table" headers={[t.cols.label, t.cols.from, t.cols.to, t.cols.source, t.cols.note, t.cols.actions]}>
              {rows.map((r) => (
                <tr key={r.id} data-testid={`track-label-${r.validFrom}`} data-source={r.source} data-label-id={r.labelId} className="border-t border-border">
                  <Td col="label">{r.labelName}</Td>
                  <Td col="from">{r.validFrom}</Td>
                  <Td col="to">{r.validTo ?? t.open}</Td>
                  <Td col="source">{t.source[r.source] ?? r.source}</Td>
                  <Td col="note">{r.note ?? ''}</Td>
                  <Td>
                    {r.source === 'operator' ? (
                      <ActionButton
                        name={`replace-track-label-${r.validFrom}`}
                        write={false}
                        op="POST /tracks/:isrc/label"
                        variant="secondary"
                        onPress={() => setForm({ from: r.validFrom, to: r.validTo ?? '', labelId: r.labelId, note: r.note ?? '' })}
                      >
                        {t.replace}
                      </ActionButton>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </QueryView>
        {form ? (
          <SetTrackLabelForm isrc={props.isrc} initial={form} onDone={() => setForm(null)} />
        ) : (
          <div>
            <ActionButton name="set-track-label" write={false} op="POST /tracks/:isrc/label" onPress={() => setForm({ from: '', to: '', note: '' })}>
              {t.set}
            </ActionButton>
          </div>
        )}
      </div>
    </FormDialog>
  );
}

/** The form of one operator interval; the answer is the whole history (the query is refreshed by the invalidation). */
function SetTrackLabelForm(props: { isrc: string; initial: { from: string; to: string; labelId?: string; note: string }; onDone: () => void }) {
  const choice = useLabelChoice();
  const [labelId, setLabelId] = useState(props.initial.labelId ?? choice.labelId);
  const [from, setFrom] = useState(props.initial.from);
  const [to, setTo] = useState(props.initial.to);
  const [note, setNote] = useState(props.initial.note);
  const run = useAction(
    () => api.tracks.setLabel(props.isrc, { labelId, from, to: to === '' ? null : to, note: note.trim() === '' ? null : note.trim() }),
    { invalidate: 'reference', success: () => t.saved },
  );
  const empty = labelId === '' || from === '';
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3" data-testid="track-label-form">
      <h3 className="text-sm font-medium">{t.setTitle}</h3>
      <p className="text-xs text-muted">{t.setSubtitle}</p>
      <LabelField name="track-label" label={t.label} value={labelId} onChange={setLabelId} isRequired />
      <DateField name="track-label-from" label={t.from} value={from} onChange={setFrom} isRequired />
      <DateField name="track-label-to" label={t.to} value={to} onChange={setTo} />
      <TextField name="track-label-note" label={t.note} value={note} onChange={setNote} />
      <div>
        <ActionButton
          name="set-track-label-submit"
          op="POST /tracks/:isrc/label"
          isPending={run.isPending}
          isDisabled={empty}
          reason={empty ? ru.actions.hints.fillFields : undefined}
          onPress={() => run.mutate(undefined, { onSuccess: props.onDone })}
        >
          {t.submit}
        </ActionButton>
      </div>
    </div>
  );
}
