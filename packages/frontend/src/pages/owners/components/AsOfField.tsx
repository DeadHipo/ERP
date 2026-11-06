import { DateField } from '../../../components/fields/DateField';
import { ru } from '../../../i18n/ru';
import { useUrlParam } from '../../catalog/components/url';

const MONTH = /^\d{4}-\d{2}$/;

/** The cut `asOf` of P9 / P10 (D-173) in the URL: a month `YYYY-MM`, '' = the whole balance. */
export function useAsOf(): [string, (v: string) => void] {
  const [value, set] = useUrlParam('asOf');
  return [MONTH.test(value) ? value : '', set];
}

/** `{ asOf }` for a money query, nothing without a cut (the key and the request stay as before). */
export const asOfQuery = (asOf: string): { asOf?: string } => (asOf ? { asOf } : {});

/**
 * «Баланс на конец месяца» (`field-as-of`): the balance as of the end of a month, applied at once (the API cuts the units,
 * statements, operations and advertising; the document statuses are today's).
 */
export function AsOfField() {
  const [asOf, setAsOf] = useAsOf();
  return (
    <div className="w-48" title={ru.operations.asOf.hint} data-testid="as-of" data-value={asOf}>
      <DateField name="as-of" label={ru.operations.asOf.field} value={asOf} onChange={(v) => setAsOf(MONTH.test(v) ? v : '')} month />
    </div>
  );
}
