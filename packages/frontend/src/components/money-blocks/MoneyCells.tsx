import type { MoneySums } from '@erp/shared/api-responses';
import { Money } from '../Money';
import { CReasonList } from '../CReasonList';
import { Td } from '../MoneyTable';

/**
 * The sums of a set of units with no unit: what a row of the list shows when the money answer has no row for it
 * (a registered track that earned nothing). A constant of the screen, not a calculation (R1).
 */
export const NO_UNITS: MoneySums = { net: '0', B: '0', C: '0', ours: '0', cByReason: {} };

/**
 * The four money cells of a block row (D-253): `[data-col="net" | "B" | "C" | "ours"]`, C with its reasons. The
 * strings are the server's (`MoneySums` of `POST /money/master/query`); without sums every cell reads «—».
 */
export function MoneyCells({ sums }: { sums: MoneySums | undefined }) {
  return (
    <>
      <Td col="net">
        <Money value={sums?.net} />
      </Td>
      <Td col="B">
        <Money value={sums?.B} />
      </Td>
      <Td col="C">
        <Money value={sums?.C} />
        {sums ? <CReasonList byReason={sums.cByReason} /> : null}
      </Td>
      <Td col="ours">
        <Money value={sums?.ours} />
      </Td>
    </>
  );
}
