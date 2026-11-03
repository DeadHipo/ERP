import { useState } from 'react';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { DateField } from '../../../components/fields/DateField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { roundedNote } from '../../catalog/track/SplitDialogs';
import { DocumentStep, type ReadyDocument } from '../../work/actions/DocumentStep';

const t = ru.reference.duplicates;
const DOC_KINDS = ['appendix', 'contract', 'other'] as const;

/**
 * «Создать сплит» for a candidate ISRC of a duplicate group, with the pseudonym preselected: a one-row split
 * (`POST /splits`); the document is optional (without it the money waits in C).
 */
export function CreateSplitForArtistDialog(props: { isrc: string; artistId: string; pseudonym: string; onClose: () => void }) {
  const [percent, setPercent] = useState('');
  const [from, setFrom] = useState('');
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  const run = useAction(
    async () => {
      const s = await api.splits.create({
        isrc: props.isrc,
        validFrom: from,
        shares: [{ artistId: props.artistId, percent: percent.trim() }],
        documentId: doc?.id ?? null,
      });
      return fmt(ru.catalog.rules.toast.splitCreated, { from: s.validFrom }) + roundedNote(from, s.validFrom);
    },
    { invalidate: 'all', success: (text) => text },
  );
  const ready = percent.trim() !== '' && from !== '';
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={fmt(t.createSplitFor, { isrc: props.isrc })}
      subtitle={t.createSplitSubtitle}
      footer={
        <ActionButton
          name="split-submit"
          isPending={run.isPending}
          isDisabled={!ready}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {t.createSplit}
        </ActionButton>
      }
    >
      <div className="text-sm">
        {t.pickArtist}: <b>{props.pseudonym}</b>
      </div>
      <TextField name="split-percent-0" label={t.percent} value={percent} onChange={setPercent} isRequired />
      <DateField name="split-from" label={t.validFrom} value={from} onChange={setFrom} isRequired />
      <DocumentStep kinds={DOC_KINDS} defaultTitle={`Приложение ${props.isrc}`} ready={doc} onReady={setDoc} />
    </FormDialog>
  );
}
