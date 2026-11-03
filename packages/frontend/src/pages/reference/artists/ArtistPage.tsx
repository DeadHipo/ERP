import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { artistQueries } from '../../../api/queries/artists';
import { splitQueries } from '../../../api/queries/splits';
import { useBreadcrumbLabel } from '../../../components/breadcrumb-label';
import { EntityLink } from '../../../components/EntityLink';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { StatusChip } from '../../../components/StatusChip';
import { ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';
import { DocumentCell, OwnerLink, period, useOwnerNames } from '../shared';
import { AssignOwnerAction } from './AssignOwnerAction';

const t = ru.reference.artists;
const r = ru.catalog.rules;

/** P12 «Псевдоним» `/artists/:id`: `GET /artists/:id`, its split rows and participations (`?artistId`), assign owner. */
export function ArtistPage() {
  const id = useParams().id ?? '';
  const names = useOwnerNames();
  const artist = useQuery(artistQueries.detail(id));
  const splits = useQuery(splitQueries.page({ artistId: id, limit: 500 }));
  const parts = useQuery(splitQueries.participationsPage({ artistId: id, limit: 500 }));
  useBreadcrumbLabel(artist.data?.pseudonym ?? id);
  return (
    <div data-testid="artist-page">
      <QueryView query={artist}>
        {(a) => (
          <div className="flex flex-col gap-6">
            <PageHeader
              title={a.pseudonym}
              subtitle={t.detailSubtitle}
              toolbar={a.ownerId === null ? <AssignOwnerAction artistId={a.id} pseudonym={a.pseudonym} /> : null}
            />
            <div className="flex flex-wrap items-center gap-4 text-sm" data-testid="artist-header">
              <span>
                {t.owner2}: <span data-testid="artist-owner"><OwnerLink ownerId={a.ownerId} names={names} /></span>
              </span>
              <StatusChip kind="artistStatus" value={a.status} />
            </div>
            <section>
              <h2 className="mb-2 text-sm font-medium">{t.splits}</h2>
              <QueryView query={splits} isEmpty={(d) => d.items.length === 0} emptyMessage={t.noSplits}>
                {(d) => (
                  <SimpleTable testId="artist-splits" headers={[ru.reference.splits.cols.isrc, r.period, r.shares, r.document]}>
                    {d.items.map((s) => (
                      <tr key={s.id} data-testid={`split-${s.id}`} className="border-t border-border">
                        <Td>
                          <EntityLink kind="isrc" id={s.isrc} />
                        </Td>
                        <Td>{period(s.validFrom, s.validTo)}</Td>
                        <Td>{s.shares.map((sh) => `${sh.pseudonym} ${sh.percent} %`).join(', ')}</Td>
                        <Td>
                          <DocumentCell id={s.documentId} status={s.documentStatus} />
                        </Td>
                      </tr>
                    ))}
                  </SimpleTable>
                )}
              </QueryView>
            </section>
            <section>
              <h2 className="mb-2 text-sm font-medium">{t.participations}</h2>
              <QueryView query={parts} isEmpty={(d) => d.items.length === 0} emptyMessage={t.noParticipations}>
                {(d) => (
                  <SimpleTable testId="artist-participations" headers={[ru.reference.splits.cols.isrc, r.percent, r.base, r.fundedFrom, r.period, r.document]}>
                    {d.items.map((p) => (
                      <tr key={p.id} data-testid={`participation-${p.id}`} className="border-t border-border">
                        <Td>
                          <EntityLink kind="isrc" id={p.isrc} />
                        </Td>
                        <Td>{p.percent}</Td>
                        <Td>{r.bases[p.base]}</Td>
                        <Td>{ru.signalsPage.funded[p.fundedFrom]}</Td>
                        <Td>{period(p.validFrom, p.validTo)}</Td>
                        <Td>
                          <DocumentCell id={p.documentId} status={p.documentStatus} />
                        </Td>
                      </tr>
                    ))}
                  </SimpleTable>
                )}
              </QueryView>
            </section>
          </div>
        )}
      </QueryView>
    </div>
  );
}
