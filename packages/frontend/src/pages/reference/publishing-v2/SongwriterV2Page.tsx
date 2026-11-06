import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publishingV2Queries } from '../../../api/queries/publishing';
import { useBreadcrumbLabel } from '../../../components/breadcrumb-label';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { ru } from '../../../i18n/ru';
import { useLabel } from '../../../lib/label';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';

const t = ru.reference.publishingV2;

/** P33 (D-182): one songwriter: the spellings, the accruals per quarter, the songs. */
export function SongwriterV2Page() {
  const { id = '' } = useParams();
  const { labelId } = useLabel();
  const query = useQuery(publishingV2Queries.songwriter(id, labelId));
  useBreadcrumbLabel(query.data?.name);
  return (
    <div data-testid="songwriter-v2-page">
      <QueryView query={query}>
        {(w) => (
          <>
            <PageHeader title={w.name} subtitle={`${t.spellings}: ${w.aliases.join(', ')}`} />
            <div className="flex flex-col gap-6">
              <section>
                <h2 className="mb-2 text-sm font-medium">{t.byPeriod}</h2>
                {w.periods.length === 0 ? (
                  <p className="text-sm text-muted">{t.noAccruals}</p>
                ) : (
                  <SimpleTable testId="songwriter-periods" headers={[t.cols.period, t.cols.gross, t.cols.withholding, t.cols.payable]}>
                    {w.periods.map((p) => (
                      <tr key={p.period}>
                        <Td>{p.period}</Td>
                        <Td><Money value={p.gross} /></Td>
                        <Td><Money value={p.withholding} /></Td>
                        <Td><Money value={p.payable} /></Td>
                      </tr>
                    ))}
                  </SimpleTable>
                )}
              </section>
              <section>
                <h2 className="mb-2 text-sm font-medium">{t.songs}</h2>
                <SimpleTable testId="songwriter-songs" headers={[t.cols.title, t.cols.periods, t.cols.payable]}>
                  {w.songs.map((s) => (
                    <tr key={s.id}>
                      <Td>{s.title}</Td>
                      <Td>{s.periods.map((p) => p.period).join(', ')}</Td>
                      <Td><Money value={s.payable} /></Td>
                    </tr>
                  ))}
                </SimpleTable>
              </section>
            </div>
          </>
        )}
      </QueryView>
    </div>
  );
}
