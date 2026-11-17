import { useQuery } from '@tanstack/react-query';
import { sublabelQueries } from '../../api/queries/sublabels';
import { SelectField } from '../../components/fields/SelectField';
import { ru } from '../../i18n/ru';

const t = ru.ads.bearer;
const PAYER = 'payer';

/**
 * «Невозвращаемую часть несёт» (D-231): the payer label (null) or a sublabel of the register, set by hand. The money
 * does not change with it (a sublabel has no recipient); the sublabel's report takes it off its part.
 */
export function BearerField(props: { value: string | null; onChange: (id: string | null) => void }) {
  const list = useQuery(sublabelQueries.list());
  return (
    <div className="flex flex-col gap-1">
      <SelectField
        name="ad-bearer"
        label={t.label}
        value={props.value ?? PAYER}
        onChange={(v) => props.onChange(v === PAYER ? null : v)}
        options={[{ id: PAYER, label: t.payer }, ...(list.data ?? []).map((s) => ({ id: s.id, label: s.name }))]}
      />
      <span className="text-xs text-muted">{t.hint}</span>
    </div>
  );
}

/** The name of a bearer for a line or a fact. */
export function useBearerName() {
  const list = useQuery(sublabelQueries.list());
  return (id: string | null) => (id ? (list.data?.find((s) => s.id === id)?.name ?? id) : t.payer);
}
