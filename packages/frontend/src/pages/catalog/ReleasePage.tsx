import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { releaseQueries } from '../../api/queries/releases';
import { useTracks } from '../../api/queries/tracks';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { ArtistLinks } from '../../components/ArtistLinks';
import { Money } from '../../components/Money';
import { TrackName } from '../../components/TrackName';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { formatLocalDateTime } from '../../lib/datetime';
import { fmt, ru } from '../../i18n/ru';
import { useLabel } from '../../lib/label';
import { SimpleTable, Td } from './components/MoneyTable';
import { CReasonList } from './components/CReasonList';

const t = ru.catalog.release;
const m = ru.catalog.money;

/**
 * P8 «Релиз»: `GET /releases/:upc` (one calculation filtered by UPC): tracks and report months with B, C, ours. The
 * name of a track row (title, version, cover) and its pseudonyms come from the track directory (`useTracks`,
 * D-250), not from the money answer.
 */
export function ReleasePage() {
  const upc = useParams().upc ?? '';
  const { labelId } = useLabel(); // the label view (D-168)
  const query = useQuery(releaseQueries.detail(upc, labelId));
  useBreadcrumbLabel(query.data ? `${query.data.title} (${upc})` : upc);
  const isrcs = useMemo(() => (query.data?.tracks ?? []).map((r) => r.isrc), [query.data]);
  const { track, artist } = useTracks(isrcs);
  return (
    <div data-testid="release-page">
      <QueryView query={query} money>
        {(data) => (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              {data.coverUrl ? <img src={data.coverUrl} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" data-testid="release-cover" /> : null}
              <PageHeader title={data.title || upc} subtitle={t.subtitle} />
            </div>
            <div className="flex flex-wrap gap-4 text-sm" data-testid="release-header">
              <span>
                UPC <b data-testid="release-upc">{data.upc}</b>
              </span>
              <span data-testid="release-artists">
                {ru.catalog.tracks.cols.artist}: <ArtistLinks artists={data.artists} reportName={data.artistName} />
              </span>
            </div>
            {/* D-172: the release registry rows of the UPC (of the label, or of every label under «Все») */}
            <section data-testid="release-registry">
              <h2 className="mb-2 text-sm font-medium">{t.registry}</h2>
              {data.registry.length === 0 ? (
                <p className="text-sm text-muted">{t.registryNone}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {data.registry.map((r) => (
                    <li key={r.labelId} data-testid={`release-registry-${r.labelId}`} data-track-count={r.trackCount ?? ''}>
                      {fmt(t.registryRow, {
                        label: r.labelName,
                        title: r.releaseTitle,
                        version: r.version ? ` (${r.version})` : '',
                        date: r.releasedAt ? formatLocalDateTime(r.releasedAt) : '—',
                        count: r.trackCount ?? '—',
                      })}
                      {r.trackCount !== null && r.trackCount > data.tracks.length ? (
                        <span className="ml-2 text-warning" data-testid="release-incomplete">
                          {fmt(t.incomplete, { seen: data.tracks.length, count: r.trackCount })}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h2 className="mb-2 text-sm font-medium">{t.tracks}</h2>
              {data.tracks.length === 0 ? (
                <p className="text-sm text-muted">{t.noTracks}</p>
              ) : (
                <SimpleTable testId="release-tracks" headers={[t.cols.title, t.cols.artists, m.net, m.B, m.C, m.ours]}>
                  {data.tracks.map((r) => (
                    <tr key={r.isrc} data-testid={`release-track-${r.isrc}`} className="border-t border-border">
                      <Td col="title">
                        <TrackName isrc={r.isrc} track={track(r.isrc)} />
                      </Td>
                      <Td col="artists">
                        {/* the pseudonyms of the track in the directory's order; nothing until its track arrives */}
                        {track(r.isrc) === undefined ? null : <ArtistLinks artists={(track(r.isrc)?.artists ?? []).flatMap((id) => artist(id) ?? [])} />}
                      </Td>
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
