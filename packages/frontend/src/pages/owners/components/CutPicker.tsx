import { useQuery } from '@tanstack/react-query';
import { settlementQueries } from '../../../api/queries/settlements';
import { SelectField } from '../../../components/fields/SelectField';
import { ru } from '../../../i18n/ru';
import { useUrlParam } from '../../catalog/components/url';

const NOW = 'now';
const t = ru.cuts.picker;

/** The cut `cut` of P10 (D-208) in the URL: a cut id, '' = the balance of today. */
export const useCutParam = (): [string, (v: string) => void] => useUrlParam('cut');

/**
 * «На срез» (`field-balance-cut`, D-208): the balance of the owner at a cut of the label (every cut under «Все»), or now.
 * Nothing when there is no cut.
 */
export function CutPicker(props: { labelId: string; value: string; onChange: (cutId: string) => void }) {
  const cuts = useQuery(settlementQueries.cuts(props.labelId));
  const items = cuts.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <div className="w-56" title={t.hint} data-testid="balance-cut" data-value={props.value}>
      <SelectField
        name="balance-cut"
        label={t.field}
        value={props.value || NOW}
        onChange={(v) => props.onChange(v === NOW ? '' : v)}
        options={[{ id: NOW, label: t.now }, ...items.map((c) => ({ id: c.id, label: `${c.name} · ${c.cutDate}` }))]}
      />
    </div>
  );
}
