import { useQuery } from '@tanstack/react-query';
import { labelQueries } from '../api/queries/labels';
import { useLabel } from '../lib/label';
import { ru } from '../i18n/ru';
import { SelectField } from './fields/SelectField';

export const ALL_LABELS = 'all';

/**
 * The label switch of the header (D-168): «0to8 / Echo8 / Все». The own labels come from `GET /labels`; the value is
 * stored like the operator and mirrored in `?label=` (the URL wins). Every money read of a page carries it.
 */
export function LabelSwitch() {
  const { labelId, setLabel } = useLabel();
  const labels = useQuery(labelQueries.list());
  const own = (labels.data ?? []).filter((l) => l.kind === 'own');
  const current = own.find((l) => l.id === labelId);
  return (
    <div className="flex items-center gap-2" data-testid="label-switch" data-label={labelId} title={ru.shell.label.help}>
      <span className="text-sm text-muted">{ru.shell.label.label}</span>
      <div className="w-36">
        <SelectField
          name="label"
          label=""
          value={labelId && (current || labels.data === undefined) ? labelId : ALL_LABELS}
          onChange={(v) => setLabel(v === ALL_LABELS ? '' : v)}
          options={[{ id: ALL_LABELS, label: ru.shell.label.all }, ...own.map((l) => ({ id: l.id, label: l.name }))]}
        />
      </div>
    </div>
  );
}

/** The own labels for a select of a dialog (D-168): the operation, the payout and an ad without an ISRC need one. */
export function useOwnLabels(): { id: string; name: string }[] {
  const labels = useQuery(labelQueries.list());
  return (labels.data ?? []).filter((l) => l.kind === 'own').map((l) => ({ id: l.id, name: l.name }));
}
