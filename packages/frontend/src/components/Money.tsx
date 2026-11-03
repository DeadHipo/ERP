import { formatMoney, isNegativeText } from '../lib/money';

/** An amount from the API: the text is `formatMoney`, the exact decimal string is in `title`; negative is red. */
export function Money({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted">—</span>;
  const text = formatMoney(value);
  return (
    <span
      data-testid="money"
      title={value}
      className={isNegativeText(text) ? 'tabular-nums text-danger' : 'tabular-nums'}
    >
      {text}
    </span>
  );
}
