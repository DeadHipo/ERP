import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import * as api from '../../../api/client';
import { ApiError } from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { FormDialog } from '../../../components/FormDialog';
import { SelectField } from '../../../components/fields/SelectField';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.money.create;

/** `details` of 409 `possible_duplicate` (`POST /owners`): the similar live records. */
const duplicateDetails = z.object({
  similar: z.array(z.object({ id: z.string(), name: z.string(), matchedBy: z.array(z.string()) })),
});
type Similar = z.output<typeof duplicateDetails>['similar'];

/**
 * «Создать владельца» (17 §6): name, kind, IPI, aliases → `POST /owners`. A 409 `possible_duplicate` opens the
 * duplicate dialog with `details.similar`: «тот же» opens that owner (nothing is created), «новый» repeats with
 * `force: true`.
 */
export function CreateOwnerDialog(props: { onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'person' | 'label'>('person');
  const [ipi, setIpi] = useState('');
  const [aliases, setAliases] = useState('');
  const [similar, setSimilar] = useState<Similar | null>(null);
  const run = useAction(
    (force: boolean) =>
      api.owners.create({
        name: name.trim(),
        kind,
        ipi: ipi.trim() || null,
        aliases: aliases
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== ''),
        force: force || undefined,
      }),
    { invalidate: 'all', success: (o) => fmt(t.toast, { name: o.name }) },
  );
  const submit = (force: boolean) =>
    run.mutate(force, {
      onSuccess: (o) => {
        props.onClose();
        void navigate(`/owners/${encodeURIComponent(o.id)}`);
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
                  void navigate(`/owners/${encodeURIComponent(s.id)}`);
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
      title={t.title}
      subtitle={t.subtitle}
      footer={
        <ActionButton
          name="create-owner-submit"
          isPending={run.isPending}
          isDisabled={name.trim() === ''}
          reason={name.trim() === '' ? ru.actions.hints.fillFields : undefined}
          onPress={() => submit(false)}
        >
          {t.submit}
        </ActionButton>
      }
    >
      <TextField name="owner-name" label={t.name} value={name} onChange={setName} isRequired />
      <SelectField
        name="owner-kind"
        label={t.kind}
        value={kind}
        onChange={(v) => setKind(v === 'label' ? 'label' : 'person')}
        options={[
          { id: 'person', label: ru.money.owners.kind.person },
          { id: 'label', label: ru.money.owners.kind.label },
        ]}
      />
      <TextField name="owner-ipi" label={t.ipi} value={ipi} onChange={setIpi} />
      <TextField name="owner-aliases" label={t.aliases} value={aliases} onChange={setAliases} />
    </FormDialog>
  );
}
