import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as api from '../../../api/client';
import type { ApiError } from '../../../api/client';
import { sublabelQueries } from '../../../api/queries/sublabels';
import { ActionButton } from '../../../components/ActionButton';
import { Money } from '../../../components/Money';
import { QueryView } from '../../../components/PageState';
import { TextField } from '../../../components/fields/TextField';
import { notifyError, notifySuccess } from '../../../components/toast';
import { fmt, ru } from '../../../i18n/ru';
import { saveBlob } from '../../../lib/download';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';

const t = ru.sublabels;

/** «Отчёт» of P37 (D-219): the tracks of the sublabel by month, its own part only; the csv is the same rows. */
export function ReportTab(props: { sublabelId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const query = useQuery(sublabelQueries.report(props.sublabelId, from, to));
  const csv = useMutation({
    mutationFn: () => api.sublabels.reportCsv(props.sublabelId, { ...(from ? { from } : {}), ...(to ? { to } : {}) }),
    onSuccess: (r) => {
      saveBlob(r.fileName, r.blob);
      notifySuccess(fmt(t.downloaded, { name: r.fileName }));
    },
    onError: (e) => notifyError(e as ApiError),
  });
  return (
    <div className="flex flex-col gap-4" data-testid="sublabel-report">
      <div className="flex flex-wrap items-end gap-3">
        <TextField name="report-from" label={t.reportFrom} type="month" value={from} onChange={setFrom} />
        <TextField name="report-to" label={t.reportTo} type="month" value={to} onChange={setTo} />
        <ActionButton name="sublabel-report-csv" write={false} op="GET /sublabels/:id/report" variant="secondary" isPending={csv.isPending} onPress={() => csv.mutate()}>
          {t.download}
        </ActionButton>
      </div>
      <p className="text-xs text-muted">{t.reportNote}</p>
      <QueryView query={query} isEmpty={(d) => d.rows.length === 0} emptyMessage={t.reportEmpty}>
        {(r) => (
          <>
            <section data-testid="sublabel-report-total" className="flex flex-wrap gap-6 text-sm">
              {(['labelShare', 'amount', 'confirmed', 'waiting', 'currentAmount'] as const).map((k) => (
                <div key={k} data-col={k} data-value={r.total[k]}>
                  <div className="text-xs text-muted">{k === 'labelShare' ? t.cols.labelShare : k === 'amount' ? t.cols.amount : k === 'currentAmount' ? t.cols.current : t[k]}</div>
                  <Money value={r.total[k]} />
                </div>
              ))}
            </section>
            <section>
              <h2 className="mb-2 text-sm font-medium">{t.reportMonths}</h2>
              <SimpleTable testId="sublabel-report-months" headers={[t.cols.month, t.cols.labelShare, t.cols.amount, t.confirmed, t.waiting, t.cols.current]}>
                {r.months.map((m) => (
                  <tr key={m.month} data-testid={`report-month-${m.month}`}>
                    <Td>{m.month}</Td>
                    <Td col="labelShare"><Money value={m.labelShare} /></Td>
                    <Td col="amount"><Money value={m.amount} /></Td>
                    <Td col="confirmed"><Money value={m.confirmed} /></Td>
                    <Td col="waiting"><Money value={m.waiting} /></Td>
                    <Td col="currentAmount"><Money value={m.currentAmount} /></Td>
                  </tr>
                ))}
              </SimpleTable>
            </section>
            <section>
              <h2 className="mb-2 text-sm font-medium">{t.reportRows}</h2>
              <SimpleTable
                testId="sublabel-report-rows"
                headers={[t.cols.month, t.cols.isrc, t.cols.title, t.cols.labelShare, t.cols.percent, t.cols.amount, t.cols.status, t.cols.current]}
              >
                {r.rows.map((x) => (
                  <tr key={`${x.month}-${x.isrc}`} data-testid={`report-row-${x.month}-${x.isrc}`} data-status={x.status} data-reason={x.reason ?? ''}>
                    <Td>{x.month}</Td>
                    <Td>{x.isrc}</Td>
                    <Td>{x.title ?? ''}</Td>
                    <Td col="labelShare"><Money value={x.labelShare} /></Td>
                    <Td>{x.percent}%</Td>
                    <Td col="amount"><Money value={x.amount} /></Td>
                    <Td col="status">{x.reason ? `${t.waiting}: ${t.reason[x.reason]}` : t.confirmed}</Td>
                    <Td col="currentAmount"><Money value={x.currentAmount} /></Td>
                  </tr>
                ))}
              </SimpleTable>
            </section>
          </>
        )}
      </QueryView>
    </div>
  );
}
