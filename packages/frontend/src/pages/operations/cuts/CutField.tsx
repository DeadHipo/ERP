import { useQuery } from '@tanstack/react-query';
import { settlementQueries } from '../../../api/queries/settlements';
import { SelectField } from '../../../components/fields/SelectField';
import { ru } from '../../../i18n/ru';

const NONE = 'none';

/**
 * «Отнести к срезу» (D-199): the cuts of the label of the operation, or «без среза» (by its date). Nothing without a
 * label: an operation without a label is never attributed. `value` '' = no cut.
 */
export function CutField(props: { name: string; labelId: string; value: string; onChange: (cutId: string) => void }) {
  const cuts = useQuery({ ...settlementQueries.cuts(props.labelId), enabled: props.labelId !== '' });
  if (props.labelId === '' || (cuts.data?.items.length ?? 0) === 0) return null;
  return (
    <SelectField
      name={props.name}
      label={ru.cuts.field}
      value={props.value || NONE}
      onChange={(v) => props.onChange(v === NONE ? '' : v)}
      options={[{ id: NONE, label: ru.cuts.noCut }, ...(cuts.data?.items ?? []).map((c) => ({ id: c.id, label: `${c.name} · ${c.cutDate}` }))]}
    />
  );
}
