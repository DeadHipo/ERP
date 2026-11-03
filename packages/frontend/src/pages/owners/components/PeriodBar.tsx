import { useState } from 'react';
import { ActionButton } from '../../../components/ActionButton';
import { DateField } from '../../../components/fields/DateField';
import { SelectField } from '../../../components/fields/SelectField';
import { ru } from '../../../i18n/ru';
import type { usePeriod } from '../../work/OverviewPage';

const t = ru.money.balance;
type Period = ReturnType<typeof usePeriod>[0];

/** The period of a money call in the URL (`from`, `to`, `basis`); applying it re-asks the API (17 §3 P10). */
export function PeriodBar(props: { period: Period; onApply: (p: Period) => void }) {
  const [from, setFrom] = useState(props.period.from ?? '');
  const [to, setTo] = useState(props.period.to ?? '');
  const [basis, setBasis] = useState<string>(props.period.basis ?? 'report');
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid="period-filter">
      <div className="w-40">
        <DateField name="period-from" label={t.from} value={from} onChange={setFrom} month />
      </div>
      <div className="w-40">
        <DateField name="period-to" label={t.to} value={to} onChange={setTo} month />
      </div>
      <div className="w-32">
        <SelectField
          name="period-basis"
          label={t.basis}
          value={basis}
          onChange={setBasis}
          options={[
            { id: 'report', label: t.report },
            { id: 'sales', label: t.sales },
          ]}
        />
      </div>
      <ActionButton
        name="period-apply"
        write={false}
        onPress={() =>
          props.onApply({
            ...(from ? { from } : {}),
            ...(to ? { to } : {}),
            ...(basis === 'sales' ? { basis: 'sales' as const } : {}),
          })
        }
      >
        {t.apply}
      </ActionButton>
      <ActionButton
        name="period-reset"
        write={false}
        variant="secondary"
        onPress={() => {
          setFrom('');
          setTo('');
          setBasis('report');
          props.onApply({});
        }}
      >
        {t.reset}
      </ActionButton>
    </div>
  );
}
