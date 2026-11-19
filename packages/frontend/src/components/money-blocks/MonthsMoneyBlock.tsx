import type { UseQueryResult } from '@tanstack/react-query';
import type { MasterRows } from '@erp/shared/api-responses';
import { QueryView } from '../PageState';
import { ru } from '../../i18n/ru';
import { SimpleTable, Td } from '../MoneyTable';
import { MoneyCells } from './MoneyCells';

const t = ru.catalog.release;
const m = ru.catalog.money;

/**
 * The block «by months» of the master money (D-253): one row per report month with B, C, ours, in the order of
 * the answer (by month, ascending). `query` is the block's own money request (`useMasterRows(scope, 'month')`) with
 * its own states; the footer is `totals` of the same answer, shown when it has rows. Nothing is added here (R1).
 *
 * Hooks: the table `<prefix>-months`, rows `<prefix>-month-<YYYY-MM>` with `[data-col="net" | "B" | "C" | "ours"]`,
 * the footer `<prefix>-months-total`.
 */
export function MonthsMoneyBlock(props: { prefix: string; query: UseQueryResult<MasterRows, Error> }) {
  const { prefix } = props;
  return (
    <QueryView query={props.query} money>
      {(data) => (
        <SimpleTable
          testId={`${prefix}-months`}
          headers={[t.cols.reportingMonth, m.net, m.B, m.C, m.ours]}
          footer={
            data.rows.length === 0 ? undefined : (
              <tr data-testid={`${prefix}-months-total`} className="border-t border-border font-medium">
                <Td>{m.total}</Td>
                <MoneyCells sums={data.totals} />
              </tr>
            )
          }
        >
          {data.rows.map((r) => (
            <tr key={r.month} data-testid={`${prefix}-month-${r.month ?? ''}`} className="border-t border-border">
              <Td>{r.month}</Td>
              <MoneyCells sums={r.sums} />
            </tr>
          ))}
        </SimpleTable>
      )}
    </QueryView>
  );
}
