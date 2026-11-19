import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { releaseQueries } from '../../api/queries/releases';
import { useMasterRows } from '../../api/queries/money';
import { useTracks } from '../../api/queries/tracks';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { ArtistLinks } from '../../components/ArtistLinks';
import { MonthsMoneyBlock } from '../../components/money-blocks/MonthsMoneyBlock';
import { TracksMoneyBlock } from '../../components/money-blocks/TracksMoneyBlock';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { formatLocalDateTime } from '../../lib/datetime';
import { fmt, ru } from '../../i18n/ru';
import { useLabel } from '../../lib/label';

const t = ru.catalog.release;

/**
 * P8 «Релиз» on the money blocks (D-253, R2′: one money request per block):
 * - `GET /releases/:upc`: the header, the registry rows and the list of the tracks of the release (also those without
 *   units, which have no money row and show the sums of no units);
 * - the block «Треки»: `POST /money/master/query` of the release at the grain `isrc`, named by the track directory
 *   (`useTracks`, D-250);
 * - the block «Месяцы»: the same scope at the grain `month`.
 * Each block has its own states and its own footer (`totals` of its answer); the label view goes to all three reads.
 */
export function ReleasePage() {
  const upc = useParams().upc ?? '';
  const { labelId } = useLabel(); // the label view (D-168)
  const query = useQuery(releaseQueries.detail(upc, labelId));
  useBreadcrumbLabel(query.data ? `${query.data.title} (${upc})` : upc);
  // the scope by value: the key of the query is structural, so a new object of the same UPC is the same query
  const scope = useMemo(() => ({ kind: 'release', upc }) as const, [upc]);
  const byTrack = useMasterRows(scope, 'isrc');
  const byMonth = useMasterRows(scope, 'month');
  // the rows of the block «Треки»: the list of the release and any ISRC only the money answer has, by ISRC; the
  // directory is asked for all of them, so a row that came from the money alone is named too
  const isrcs = useMemo(
    () => [...new Set([...(query.data?.tracks ?? []).map((r) => r.isrc), ...(byTrack.data?.rows ?? []).flatMap((r) => r.isrc ?? [])])].sort(),
    [query.data, byTrack.data],
  );
  const tracks = useTracks(isrcs);
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
                <TracksMoneyBlock prefix="release" query={byTrack} isrcs={isrcs} noUnits="zero" tracks={tracks} />
              )}
            </section>
            <section>
              <h2 className="mb-2 text-sm font-medium">{t.months}</h2>
              <MonthsMoneyBlock prefix="release" query={byMonth} />
            </section>
          </div>
        )}
      </QueryView>
    </div>
  );
}
