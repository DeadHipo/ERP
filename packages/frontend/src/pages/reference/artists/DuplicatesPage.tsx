import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { artistQueries } from '../../../api/queries/artists';
import { ActionButton } from '../../../components/ActionButton';
import { EntityLink } from '../../../components/EntityLink';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { StatusChip } from '../../../components/StatusChip';
import { ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';
import { OwnerLink, useOwnerNames } from '../shared';
import { AssignOwnerAction } from './AssignOwnerAction';
import { CreateSplitForArtistDialog } from './CreateSplitForArtistDialog';

const t = ru.reference.duplicates;

/** P11 `/artists/duplicates`: `GET /artists/duplicates` (N11): groups of one pseudonym, usage and ISRCs without a split. */
export function DuplicatesPage() {
  const query = useQuery(artistQueries.duplicates());
  const names = useOwnerNames();
  const [split, setSplit] = useState<{ isrc: string; artistId: string; pseudonym: string } | null>(null);
  return (
    <div data-testid="artist-duplicates-page">
      <PageHeader
        title={t.title}
        subtitle={t.subtitle}
        toolbar={
          <Link to="/artists" className="text-sm text-accent hover:underline">
            {t.back}
          </Link>
        }
      />
      <QueryView query={query} isEmpty={(d) => d.groups.length === 0} emptyMessage={t.empty}>
        {(data) => (
          <div className="flex flex-col gap-6">
            {data.groups.map((g) => {
              const target = g.artists.find((a) => a.ownerId !== null) ?? g.artists[0];
              return (
                <section key={g.normalized} data-testid={`duplicate-group-${g.normalized}`} className="rounded-xl border border-border p-3">
                  <h2 className="mb-2 text-sm font-medium">
                    {t.group}: {g.normalized}
                  </h2>
                  <SimpleTable testId="duplicate-artists" headers={[t.artists, t.cols.owner, t.cols.status, t.cols.splitRows, t.cols.participations, '']}>
                    {g.artists.map((a) => (
                      <tr key={a.id} data-testid={`duplicate-artist-${a.id}`} className="border-t border-border">
                        <Td col="pseudonym">
                          <EntityLink kind="artist" id={a.id} label={a.pseudonym} />
                        </Td>
                        <Td col="owner">
                          <OwnerLink ownerId={a.ownerId} names={names} />
                        </Td>
                        <Td col="status">
                          <StatusChip kind="artistStatus" value={a.status} />
                        </Td>
                        <Td col="splitRows">{a.splitRows}</Td>
                        <Td col="participations">{a.participations}</Td>
                        <Td>
                          <span className="flex flex-wrap gap-2">
                            {a.ownerId === null ? (
                              <AssignOwnerAction artistId={a.id} pseudonym={a.pseudonym} />
                            ) : (
                              <Link to={`/owners/${encodeURIComponent(a.ownerId)}`} className="text-sm text-accent hover:underline" data-testid="action-merge-owners">
                                {t.mergeOwners}
                              </Link>
                            )}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </SimpleTable>
                  <h3 className="mb-1 mt-3 text-xs font-medium text-muted">{t.candidates}</h3>
                  {g.candidateIsrcs.length === 0 ? (
                    <p className="text-sm text-muted" data-testid="no-candidates">
                      {t.noCandidates}
                    </p>
                  ) : (
                    <SimpleTable testId="candidate-isrcs" headers={[t.cols.isrc, t.cols.upc, t.cols.title, t.cols.net, '']}>
                      {g.candidateIsrcs.map((c) => (
                        <tr key={c.isrc} data-testid={`candidate-${c.isrc}`} className="border-t border-border">
                          <Td>
                            <EntityLink kind="isrc" id={c.isrc} />
                          </Td>
                          <Td>
                            <EntityLink kind="upc" id={c.upc} />
                          </Td>
                          <Td>{c.trackTitle}</Td>
                          <Td col="net">
                            <Money value={c.net} />
                          </Td>
                          <Td>
                            {target ? (
                              <ActionButton name="create-split" op="POST /splits" variant="secondary" onPress={() => setSplit({ isrc: c.isrc, artistId: target.id, pseudonym: target.pseudonym })}>
                                {t.createSplit}
                              </ActionButton>
                            ) : null}
                          </Td>
                        </tr>
                      ))}
                    </SimpleTable>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </QueryView>
      {split ? <CreateSplitForArtistDialog {...split} onClose={() => setSplit(null)} /> : null}
    </div>
  );
}
