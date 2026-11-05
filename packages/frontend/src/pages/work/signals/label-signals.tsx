import type { ReactNode } from 'react';
import type { ColDef } from 'ag-grid-community';
import type { Signals } from '@erp/shared/api-responses';
import { EntityLink } from '../../../components/EntityLink';
import { StatusChip } from '../../../components/StatusChip';
import { ru } from '../../../i18n/ru';
import { centsToText } from '../../owners/components/cents';
import { SetOperationLabelDialog } from '../actions/dialogs';
import { SIGNAL_ACTIONS } from '../actions/action-table';
import { actionCol, btn, c, Grid, info, moneyCol, t, textCol, type ListProps } from './signal-grid';

/**
 * The label lists of P21 (D-168, D-169): one renderer per list name. `SignalsPage.tsx` asks this table first, so a new
 * label list (`statementsWithoutLabel`, `adsWithoutLabel`, `adOutsideBook`) is one entry here plus its string in
 * `i18n/ru/signals.ts` and its row in `actions/action-table.ts`.
 */
export const LABEL_SIGNALS = {
  operationsWithoutLabel: ({ data, count, open, close }: ListProps): ReactNode => {
    type R = Signals['operationsWithoutLabel'][number];
    return (
      <Grid<R>
        name="operationsWithoutLabel"
        count={count}
        rows={data.operationsWithoutLabel}
        rowKey={(r) => r.operationId}
        columns={[
          textCol('date', c.date, (r) => r.date),
          {
            colId: 'owner',
            headerName: c.owner,
            minWidth: 160,
            valueGetter: (p) => p.data?.ownerName ?? '',
            cellRenderer: (p: { data?: R }) =>
              p.data?.ownerId ? <EntityLink kind="owner" id={p.data.ownerId} label={p.data.ownerName ?? p.data.ownerId} /> : <span>—</span>,
          },
          {
            colId: 'pseudonym',
            headerName: c.pseudonym,
            valueGetter: (p) => p.data?.pseudonym ?? '',
            cellRenderer: (p: { data?: R }) =>
              p.data?.artistId ? <EntityLink kind="artist" id={p.data.artistId} label={p.data.pseudonym ?? p.data.artistId} /> : <span>—</span>,
          },
          {
            colId: 'meaning',
            headerName: c.meaning,
            valueGetter: (p) => p.data?.meaning,
            cellRenderer: (p: { data?: R }) => (p.data ? <StatusChip kind="operationMeaning" value={p.data.meaning} /> : null),
          },
          moneyCol('amount', c.amount, (r) => centsToText(r.amountCents)),
          actionCol((r) =>
            btn('set-label', ru.actions.setLabel, () => open(<SetOperationLabelDialog operationId={r.operationId} onClose={close} />)),
          ),
        ]}
      />
    );
  },
  labelOutsideAccount: ({ data, count }: ListProps): ReactNode => {
    type R = Signals['labelOutsideAccount'][number];
    return (
      <Grid<R>
        name="labelOutsideAccount"
        count={count}
        rows={data.labelOutsideAccount}
        rowKey={(r) => `${r.account}|${r.month}|${r.labelName}`}
        columns={[
          textCol('account', c.account, (r) => r.account),
          textCol('month', c.month, (r) => r.month),
          textCol('label', c.label, (r) => r.labelName),
          textCol('ourLabel', c.ourLabel, (r) => r.ourLabelName),
          textCol('accountLabel', c.accountLabel, (r) => r.accountLabelName),
          moneyCol('net', c.net, (r) => r.net),
          textCol('units', c.units, (r) => String(r.units)),
          informationCol<R>('labelOutsideAccount'),
        ]}
      />
    );
  },
  filesWithoutLabel: ({ data, count }: ListProps): ReactNode => {
    type R = Signals['filesWithoutLabel'][number];
    return (
      <Grid<R>
        name="filesWithoutLabel"
        count={count}
        rows={data.filesWithoutLabel}
        rowKey={(r) => r.fileId}
        columns={[
          textCol('account', c.account, (r) => r.account),
          textCol('month', c.month, (r) => r.reportingMonth),
          textCol('fileName', c.fileName, (r) => r.fileName),
          informationCol<R>('filesWithoutLabel'),
        ]}
      />
    );
  },
} satisfies Partial<Record<keyof typeof SIGNAL_ACTIONS, (props: ListProps) => ReactNode>>;

export type LabelSignalName = keyof typeof LABEL_SIGNALS;

/** The action column of an information list (`SIGNAL_ACTIONS[name].information`): the note, no button. */
function informationCol<T>(name: LabelSignalName): ColDef<T> {
  return actionCol<T>(() => (SIGNAL_ACTIONS[name].information ? info(t.info) : null));
}
