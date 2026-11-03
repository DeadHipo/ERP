import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { releaseQueries } from '../../api/queries/releases';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { ru } from '../../i18n/ru';
import { SimpleTable, Td } from './components/MoneyTable';
import { CReasonList } from './components/CReasonList';

const t = ru.catalog.release;
const m = ru.catalog.money;

/** P8 «Релиз»: `GET /releases/:upc` (one calculation filtered by UPC): tracks and report months with B, C, ours. */
export function ReleasePage() {
  const upc = useParams().upc ?? '';
  const query = useQuery(releaseQueries.detail(upc));
  useBreadcrumbLabel(query.data ? `${query.data.title} (${upc})` : upc);
  return (
    <div data-testid="release-page">
      <QueryView query={query} money>
        {(data) => (
          <div className="flex flex-col gap-4">
            <PageHeader title={data.title || upc} subtitle={t.subtitle} />
            <div className="flex flex-wrap gap-4 text-sm" data-testid="release-header">
              <span>
                UPC <b data-testid="release-upc">{data.upc}</b>
              </span>
              <span>
                {ru.catalog.tracks.cols.artist}: {data.artistName || '—'}
              </span>
            </div>
            <section>
              <h2 className="mb-2 text-sm font-medium">{t.tracks}</h2>
              {data.tracks.length === 0 ? (
                <p className="text-sm text-muted">{t.noTracks}</p>
              ) : (
                <SimpleTable testId="release-tracks" headers={[t.cols.isrc, t.cols.title, m.net, m.B, m.C, m.ours]}>
                  {data.tracks.map((r) => (
                    <tr key={r.isrc} data-testid={`release-track-${r.isrc}`} className="border-t border-border">
                      <Td>
                        <EntityLink kind="isrc" id={r.isrc} />
                      </Td>
                      <Td>{r.title}</Td>
                      <Td col="net">
                        <Money value={r.net} />
                      </Td>
                      <Td col="B">
                        <Money value={r.B} />
                      </Td>
                      <Td col="C">
                        <Money value={r.C} />
                        <CReasonList byReason={r.cByReason} />
                      </Td>
                      <Td col="ours">
                        <Money value={r.ours} />
                      </Td>
                    </tr>
                  ))}
                </SimpleTable>
              )}
            </section>
            <section>
              <h2 className="mb-2 text-sm font-medium">{t.months}</h2>
              <SimpleTable testId="release-months" headers={[t.cols.reportingMonth, m.net, m.B, m.C, m.ours]}>
                {data.months.map((r) => (
                  <tr key={r.reportingMonth} data-testid={`release-month-${r.reportingMonth}`} className="border-t border-border">
                    <Td>{r.reportingMonth}</Td>
                    <Td col="net">
                      <Money value={r.net} />
                    </Td>
                    <Td col="B">
                      <Money value={r.B} />
                    </Td>
                    <Td col="C">
                      <Money value={r.C} />
                      <CReasonList byReason={r.cByReason} />
                    </Td>
                    <Td col="ours">
                      <Money value={r.ours} />
                    </Td>
                  </tr>
                ))}
              </SimpleTable>
            </section>
          </div>
        )}
      </QueryView>
    </div>
  );
}
