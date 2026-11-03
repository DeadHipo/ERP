import type { z } from 'zod';
import { possibleDuplicateDetailsSchema } from '@erp/shared/api-responses';
import { ApiError } from '../api/client';
import { ActionButton } from './ActionButton';
import { FormDialog } from './FormDialog';
import { ru } from '../i18n/ru';

export type Similar = z.output<typeof possibleDuplicateDetailsSchema>['similar'];

/** The similar records of a 409 `possible_duplicate` (`POST /owners`, `POST /artists`), or null for any other error. */
export function similarOf(error: unknown): Similar | null {
  if (!(error instanceof ApiError) || error.code !== 'possible_duplicate') return null;
  const parsed = possibleDuplicateDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data.similar : null;
}

const matchedByText = (values: readonly string[]) =>
  values.map((v) => (Object.hasOwn(ru.dialog.matchedBy, v) ? ru.dialog.matchedBy[v] : undefined) ?? v).join(', ');

/**
 * The one duplicate dialog (17 §6): the similar records with «тот же» (`action-duplicate-same`, the caller opens or uses
 * that record; nothing is created) and «новый» (`action-duplicate-new`, the caller repeats with `force: true`).
 * Hooks: `duplicate-dialog`, `duplicate-<id>`.
 */
export function DuplicateDialog(props: {
  title: string;
  text: string;
  matchedBy: string;
  same: string;
  fresh: string;
  similar: Similar;
  pending: boolean;
  onSame: (id: string, name: string) => void;
  onFresh: () => void;
  onClose: () => void;
}) {
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={props.title}
      subtitle={props.text}
      footer={
        <ActionButton name="duplicate-new" isPending={props.pending} onPress={props.onFresh}>
          {props.fresh}
        </ActionButton>
      }
    >
      <ul className="flex flex-col gap-2" data-testid="duplicate-dialog">
        {props.similar.map((s) => (
          <li
            key={s.id}
            data-testid={`duplicate-${s.id}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"
          >
            <span>
              <b>{s.name}</b>{' '}
              <span className="text-muted" data-testid="duplicate-matched-by">
                ({props.matchedBy}: {matchedByText(s.matchedBy)})
              </span>
            </span>
            <ActionButton name="duplicate-same" write={false} variant="secondary" onPress={() => props.onSame(s.id, s.name)}>
              {props.same}
            </ActionButton>
          </li>
        ))}
      </ul>
    </FormDialog>
  );
}
