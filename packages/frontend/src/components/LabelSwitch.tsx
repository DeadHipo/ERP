import { useQuery } from '@tanstack/react-query';
import type { Me } from '@erp/shared/api-responses';
import { useMe } from '../api/queries/auth';
import { labelQueries } from '../api/queries/labels';
import { useLabel } from '../lib/label';
import { ru } from '../i18n/ru';
import { SelectField } from './fields/SelectField';

export const ALL_LABELS = 'all';

/**
 * The labels a session may choose (D-171): an `org_admin`, `local` and support every own label (`me.allLabels`), a
 * label manager those of `me.labels`. `GET /labels` keeps the list fresh (a label created on P17 shows at once).
 */
function choosable(
  labels: readonly { id: string; name: string; kind: string }[],
  me: Pick<Me, 'allLabels' | 'labels'> | undefined,
): { id: string; name: string }[] {
  const own = labels.filter((l) => l.kind === 'own');
  const mine = me && !me.allLabels ? own.filter((l) => me.labels.some((x) => x.id === l.id)) : own;
  return mine.map((l) => ({ id: l.id, name: l.name }));
}

/**
 * The label switch of the header (D-168): «0to8 / Echo8 / Все». The labels the session may choose (D-171: «Все» only
 * with `me.allLabels`); the value is stored like the operator and mirrored in `?label=` (the URL wins). Every money read
 * of a page carries it.
 */
export function LabelSwitch({ me }: { me: Me }) {
  const { labelId, setLabel } = useLabel();
  const labels = useQuery(labelQueries.list());
  const own = choosable(labels.data ?? [], me);
  const current = own.find((l) => l.id === labelId);
  const all = me.allLabels ? [{ id: ALL_LABELS, label: ru.shell.label.all }] : [];
  return (
    <div className="flex items-center gap-2" data-testid="label-switch" data-label={labelId} title={ru.shell.label.help}>
      <span className="text-sm text-muted">{ru.shell.label.label}</span>
      <div className="w-36">
        <SelectField
          name="label"
          label=""
          value={labelId && (current || labels.data === undefined) ? labelId : me.allLabels ? ALL_LABELS : null}
          onChange={(v) => setLabel(v === ALL_LABELS ? '' : v)}
          options={[...all, ...own.map((l) => ({ id: l.id, label: l.name }))]}
        />
      </div>
    </div>
  );
}

/**
 * The own labels for a select of a dialog (D-168): the operation, the payout and an ad without an ISRC need one. A
 * label manager gets only their labels (D-171).
 */
export function useOwnLabels(): { id: string; name: string }[] {
  const labels = useQuery(labelQueries.list());
  const me = useMe();
  return choosable(labels.data ?? [], me.data);
}
