import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { DuplicateDialog, similarOf, type Similar } from '../../../components/DuplicateDialog';
import { FormDialog } from '../../../components/FormDialog';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.reference.artists;

/** «Создать псевдоним»: `POST /artists`; a 409 `possible_duplicate` opens the duplicate dialog («тот же» / «новый» with force). */
export function CreateArtistDialog(props: { onClose: () => void }) {
  const navigate = useNavigate();
  const [pseudonym, setPseudonym] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [similar, setSimilar] = useState<Similar | null>(null);
  const run = useAction(
    (force: boolean) => api.artists.create({ pseudonym: pseudonym.trim(), ownerId: owner, force: force || undefined }),
    { invalidate: 'all', success: (a) => fmt(t.created, { pseudonym: a.pseudonym }) },
  );
  const submit = (force: boolean) =>
    run.mutate(force, {
      onSuccess: (a) => {
        props.onClose();
        void navigate(`/artists/${encodeURIComponent(a.id)}`);
      },
      onError: (e) => {
        const found = similarOf(e);
        if (found) setSimilar(found);
      },
    });

  if (similar) {
    return (
      <DuplicateDialog
        title={t.duplicateTitle}
        text={t.duplicateText}
        matchedBy={t.matchedBy}
        same={t.same}
        fresh={t.fresh}
        similar={similar}
        pending={run.isPending}
        onFresh={() => submit(true)}
        onClose={props.onClose}
        onSame={(id) => {
          props.onClose();
          void navigate(`/artists/${encodeURIComponent(id)}`);
        }}
      />
    );
  }
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.createTitle}
      subtitle={t.createSubtitle}
      footer={
        <ActionButton
          name="create-artist-submit"
          isPending={run.isPending}
          isDisabled={pseudonym.trim() === ''}
          reason={ru.actions.hints.fillFields}
          onPress={() => submit(false)}
        >
          {ru.common.create}
        </ActionButton>
      }
    >
      <TextField name="artist-pseudonym" label={t.pseudonym} value={pseudonym} onChange={setPseudonym} isRequired />
      <EntityPicker name="artist-owner" label={t.owner} kind="owners" value={owner} onChange={(id) => setOwner(id)} />
    </FormDialog>
  );
}
