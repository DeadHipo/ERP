import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import * as api from '../../../api/client';
import { ApiError } from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { EntityPicker } from '../../../components/fields/EntityPicker';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.reference.artists;

/** `details` of 409 `possible_duplicate` (`POST /artists`): the similar live pseudonyms. */
const duplicateDetails = z.object({
  similar: z.array(z.object({ id: z.string(), name: z.string(), matchedBy: z.array(z.string()) })),
});
type Similar = z.output<typeof duplicateDetails>['similar'];

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
        if (e instanceof ApiError && e.code === 'possible_duplicate') {
          const d = duplicateDetails.safeParse(e.details);
          if (d.success) setSimilar(d.data.similar);
        }
      },
    });

  if (similar) {
    return (
      <FormDialog
        isOpen
        onOpenChange={(o) => (o ? null : props.onClose())}
        title={t.duplicateTitle}
        subtitle={t.duplicateText}
        footer={
          <ActionButton name="duplicate-new" isPending={run.isPending} onPress={() => submit(true)}>
            {t.fresh}
          </ActionButton>
        }
      >
        <ul className="flex flex-col gap-2" data-testid="duplicate-dialog">
          {similar.map((s) => (
            <li key={s.id} data-testid={`duplicate-${s.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
              <span>
                <b>{s.name}</b> <span className="text-muted">({t.matchedBy}: {s.matchedBy.join(', ')})</span>
              </span>
              <ActionButton
                name="duplicate-same"
                write={false}
                variant="secondary"
                onPress={() => {
                  props.onClose();
                  void navigate(`/artists/${encodeURIComponent(s.id)}`);
                }}
              >
                {t.same}
              </ActionButton>
            </li>
          ))}
        </ul>
      </FormDialog>
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
