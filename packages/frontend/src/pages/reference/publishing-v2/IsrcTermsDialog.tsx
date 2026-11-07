import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { pubV2SongSchema } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { publishingV2Queries } from '../../../api/queries/publishing';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { QueryView } from '../../../components/PageState';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';

const t = ru.reference.publishingV2;
type Song = z.output<typeof pubV2SongSchema>;
type Terms = Song['terms'];

/** The text of the term of a song today (D-192): the grid cell and the head of the dialog. */
export function songTermsText(terms: Terms): string {
  if (terms.state === 'conflict') return t.termState.conflict;
  if (terms.state === 'isrc') return fmt(t.termState.isrc, { percent: terms.percent ?? '' });
  return terms.percent === null ? t.noTermShort : fmt(t.termState.owner, { percent: terms.percent });
}

/**
 * The terms of the ISRCs of a song (D-192): a buyout or special terms of the owner on a track win over the owner's own
 * percent. A term is never edited: a new one closes the open one of the same ISRC; a mistake is cancelled.
 */
export function IsrcTermsDialog(props: { song: Song; onClose: () => void }) {
  const query = useQuery(publishingV2Queries.songCandidates(props.song.songId));
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [percent, setPercent] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [basis, setBasis] = useState('');
  const [document, setDocument] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const isrcs = props.song.isrcs;
  const picked = chosen ?? new Set(isrcs);
  const ownerId = query.data?.ownerId ?? props.song.ownerId;
  const run = useAction(
    async () => {
      const done = [];
      for (const isrc of [...picked].sort())
        done.push(
          await api.publishingV2.setTerm({ ownerId: ownerId ?? '', percent: percent.trim(), validFrom, documentId: document, isrc, basis: basis.trim() || null }),
        );
      return done;
    },
    { invalidate: 'all', success: (r) => fmt(t.isrcTermSet, { count: String(r.length), percent: percent.trim(), from: validFrom }) },
  );
  const cancel = useAction((termId: string) => api.publishingV2.cancelTerm(termId, reason.trim()), {
    invalidate: 'all',
    success: () => t.termCancelled,
  });
  const toggle = (isrc: string) => {
    const next = new Set(picked);
    if (next.has(isrc)) next.delete(isrc);
    else next.add(isrc);
    setChosen(next);
  };
  const closed = ownerId === null ? t.isrcTermNeedsOwner : isrcs.length === 0 ? t.isrcTermNeedsIsrc : null;
  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => (open ? null : props.onClose())}
      title={fmt(t.isrcTermTitle, { name: props.song.title })}
      footer={
        <ActionButton
          name="isrc-term-submit"
          op="POST /publishing-v2/terms"
          isPending={run.isPending}
          isDisabled={closed !== null || picked.size === 0 || percent.trim() === '' || validFrom === ''}
          reason={closed ?? t.termNeeds}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {t.save}
        </ActionButton>
      }
    >
      <QueryView query={query}>
        {(d) => {
          const last = new Map<string, (typeof d.isrcTerms)[number]>();
          for (const x of d.isrcTerms) if (!last.has(x.isrc) || x.validFrom > (last.get(x.isrc)?.validFrom ?? '')) last.set(x.isrc, x);
          return (
            <div className="flex flex-col gap-3">
              <div className="text-sm" data-testid="isrc-terms-state" data-state={d.terms.state}>
                {d.ownerName ? `${t.cols.owner}: ${d.ownerName} · ` : ''}
                {songTermsText(d.terms)}
                {d.terms.state !== 'owner' && d.terms.ownerPercent !== null ? ` · ${fmt(t.termState.ownerOwn, { percent: d.terms.ownerPercent })}` : ''}
              </div>
              {d.terms.state === 'conflict' ? <p className="text-xs text-danger">{t.conflictHint}</p> : null}
              {d.isrcTerms.length === 0 ? (
                <p className="text-sm text-muted">{t.noIsrcTerms}</p>
              ) : (
                <SimpleTable testId="isrc-term-history" headers={[t.cols.isrcs, t.cols.percent, t.cols.from, t.cols.to, t.cols.basis, '']}>
                  {d.isrcTerms.map((x) => (
                    <tr key={x.id} data-testid={`isrc-term-${x.id}`}>
                      <Td>{x.isrc}</Td>
                      <Td>{x.percent}%</Td>
                      <Td>{x.validFrom}</Td>
                      <Td>{x.validTo ?? t.openEnded}</Td>
                      <Td>{x.basis ?? ''}</Td>
                      <Td>
                        {last.get(x.isrc)?.id === x.id ? (
                          <ActionButton
                            name={`cancel-isrc-term-${x.id}`}
                            op="POST /publishing-v2/terms/:id/cancel"
                            variant="secondary"
                            compact
                            isPending={cancel.isPending}
                            isDisabled={reason.trim() === ''}
                            reason={t.cancelReason}
                            onPress={() => cancel.mutate(x.id)}
                          >
                            {t.cancelTerm}
                          </ActionButton>
                        ) : null}
                      </Td>
                    </tr>
                  ))}
                </SimpleTable>
              )}
              {d.isrcTerms.length > 0 ? <TextField name="isrc-term-cancel-reason" label={t.cancelReason} value={reason} onChange={setReason} /> : null}
            </div>
          );
        }}
      </QueryView>
      <div className="flex flex-col gap-1" data-testid="isrc-term-isrcs">
        <span className="text-sm">{t.isrcTermFor}</span>
        {isrcs.map((isrc) => (
          <label key={isrc} className="flex items-center gap-2 text-sm">
            <input type="checkbox" data-testid={`isrc-term-pick-${isrc}`} checked={picked.has(isrc)} onChange={() => toggle(isrc)} />
            <span className="tabular-nums">{isrc}</span>
          </label>
        ))}
      </div>
      <TextField name="isrc-term-percent" label={t.cols.percent} value={percent} onChange={setPercent} placeholder="0" />
      <TextField name="isrc-term-from" label={t.cols.from} type="date" value={validFrom} onChange={setValidFrom} />
      <TextField name="isrc-term-basis" label={t.isrcTermBasis} value={basis} onChange={setBasis} />
      <p className="text-xs text-muted">{t.isrcTermHint}</p>
      <EntityPicker name="isrc-term-document" label={t.termDocument} kind="documents" value={document} onChange={(id) => setDocument(id)} />
    </FormDialog>
  );
}
