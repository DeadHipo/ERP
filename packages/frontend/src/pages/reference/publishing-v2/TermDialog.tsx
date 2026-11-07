import { useState } from 'react';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';

const t = ru.reference.publishingV2;

/** «Сплит» (D-185): a term is never edited: the open one closes at the date and a new one starts. */
export function TermDialog(props: {
  ownerId: string;
  ownerName: string;
  terms: { percent: string; validFrom: string; validTo: string | null; documentId: string | null }[];
  onClose: () => void;
}) {
  const [percent, setPercent] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [document, setDocument] = useState<string | null>(null);
  const run = useAction(
    () => api.publishingV2.setTerm({ ownerId: props.ownerId, percent: percent.trim(), validFrom, documentId: document }),
    { invalidate: 'all', success: (r) => fmt(t.termSet, { percent: r.percent, from: r.validFrom }) },
  );
  return (
    <FormDialog
      isOpen
      onOpenChange={(open) => (open ? null : props.onClose())}
      title={fmt(t.termTitle, { name: props.ownerName })}
      footer={
        <ActionButton
          name="term-submit"
          op="POST /publishing-v2/terms"
          isPending={run.isPending}
          isDisabled={percent.trim() === '' || validFrom === ''}
          reason={t.termNeeds}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {t.save}
        </ActionButton>
      }
    >
      {props.terms.length === 0 ? (
        <p className="text-sm text-muted">{t.noTerms}</p>
      ) : (
        <SimpleTable testId="term-history" headers={[t.cols.percent, t.cols.from, t.cols.to]}>
          {props.terms.map((x) => (
            <tr key={`${x.validFrom}-${x.percent}`}>
              <Td>{x.percent}%</Td>
              <Td>{x.validFrom}</Td>
              <Td>{x.validTo ?? t.openEnded}</Td>
            </tr>
          ))}
        </SimpleTable>
      )}
      <TextField name="term-percent" label={t.cols.percent} value={percent} onChange={setPercent} placeholder="50" />
      <TextField name="term-from" label={t.cols.from} type="date" value={validFrom} onChange={setValidFrom} />
      <p className="text-xs text-muted">{t.termHint}</p>
      <EntityPicker name="term-document" label={t.termDocument} kind="documents" value={document} onChange={(id) => setDocument(id)} />
    </FormDialog>
  );
}
