import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LabelListItem } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { labelQueries } from '../../../api/queries/labels';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { DateField } from '../../../components/fields/DateField';
import { SelectField } from '../../../components/fields/SelectField';
import { fmt, ru } from '../../../i18n/ru';
import { roundedNote } from '../../catalog/track/SplitDialogs';

const t = ru.reference.labels;
const a = ru.actions;
const f = a.fields;

type Rule = LabelListItem['rules'][number];
type Candidate = { label: LabelListItem; rule: Rule };

const period = (from: string, to: string | null) => `${from} → ${to ?? ru.reference.common.open}`;
const ruleText = (c: Candidate) =>
  `${c.label.name} → ${c.rule.recipientPseudonym} ${c.rule.percent} % (${period(c.rule.validFrom, c.rule.validTo)})`;

/** A rule in force on a date (ISO strings compare as text; `validTo` is exclusive). */
const inForce = (r: Rule, date: string) => r.validFrom <= date && (r.validTo === null || date < r.validTo);

/**
 * «Закрыть правило» (P17 label card, P21 ruleRecipientIsRow, D-126): the operator picks the rule to close from
 * `GET /labels` (the rules of `labelId`, or every rule whose recipient is `artistId`); one is preselected when it is the
 * given `ruleId` or the only one in force (at `month` from a signal, else open-ended). The confirmation states the rule's
 * label, recipient, percent and period, and the close date as typed (the backend floors it; the toast states the stored
 * date). Hooks: `close-rule-pick`, `close-rule-what`, `field-close-at`, `action-close-rule-submit`.
 */
export function CloseRuleDialog(props: {
  labelId?: string;
  artistId?: string;
  ruleId?: string;
  /** `YYYY-MM` of a signal row: the close field becomes a month and starts there. */
  month?: string;
  onClose: () => void;
}) {
  const labels = useQuery(labelQueries.list());
  const candidates: Candidate[] = (labels.data ?? []).flatMap((label) =>
    props.labelId !== undefined && label.id !== props.labelId
      ? []
      : label.rules
          .filter((rule) => props.artistId === undefined || rule.recipientArtistId === props.artistId)
          .map((rule) => ({ label, rule })),
  );
  const at = props.month ? `${props.month}-01` : null;
  const current = candidates.filter((c) => (at ? inForce(c.rule, at) : c.rule.validTo === null));
  const preselected = props.ruleId ?? (current.length === 1 ? current[0]?.rule.id : candidates.length === 1 ? candidates[0]?.rule.id : undefined);
  const [picked, setPicked] = useState<string | null>(null);
  const chosenId = picked ?? preselected ?? null;
  const chosen = candidates.find((c) => c.rule.id === chosenId);
  const [to, setTo] = useState(props.month ?? '');
  const [confirm, setConfirm] = useState(false);
  const sent = props.month ? (to.length === 7 ? `${to}-01` : to) : to;
  const run = useAction(
    async (ruleId: string) => {
      const closed = await api.labels.closeRule(ruleId, { validTo: sent });
      return fmt(t.ruleClosed, { to: closed.validTo ?? '' }) + roundedNote(sent, closed.validTo ?? '');
    },
    { invalidate: 'all', success: (text) => text },
  );
  const what = chosen ? ruleText(chosen) : '';
  return (
    <>
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.closeTitle}
        subtitle={a.hints.monthRule}
        footer={
          <ActionButton
            name="close-rule-submit" op="POST /labels/rules/:id/close"
            isDisabled={!chosen || to === ''}
            reason={!chosen ? (labels.data ? a.hints.pickRule : ru.common.loading) : a.hints.fillFields}
            isPending={run.isPending}
            onPress={() => setConfirm(true)}
          >
            {t.closeRule}
          </ActionButton>
        }
      >
        {labels.data && candidates.length === 0 ? <div className="text-sm">{a.hints.noRule}</div> : null}
        {candidates.length > 1 ? (
          <SelectField
            name="close-rule-pick"
            label={f.rule}
            value={chosenId}
            onChange={setPicked}
            options={candidates.map((c) => ({ id: c.rule.id, label: ruleText(c) }))}
          />
        ) : null}
        <div className="text-sm" data-testid="close-rule-what">
          {what}
        </div>
        <DateField name="close-at" label={t.closeAt} value={to} onChange={setTo} month={props.month !== undefined} isRequired />
      </FormDialog>
      <ConfirmDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t.closeTitle}
        lines={[...t.closeLines(what, sent)]}
        isPending={run.isPending}
        onConfirm={() => chosen && run.mutate(chosen.rule.id, { onSuccess: props.onClose, onSettled: () => setConfirm(false) })}
      />
    </>
  );
}
