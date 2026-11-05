import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { artistQueries } from '../../api/queries/artists';
import { EntityCard } from '../../components/EntityCard';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { QueryView, StaleBadge } from '../../components/PageState';
import { StatusChip } from '../../components/StatusChip';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { fmt, ru } from '../../i18n/ru';
import { AdsOfEntity } from '../ads/AdsOfEntity';
import { AssignOwnerAction } from '../reference/artists/AssignOwnerAction';
import { PeriodBar } from '../owners/components/PeriodBar';
import { usePeriod } from '../work/OverviewPage';
import { ArtistBalanceTab } from './ArtistBalanceTab';
import { ArtistDocumentsTab, ArtistHistoryTab, ArtistOperationsTab, ArtistRulesTab } from './tabs';

const t = ru.money.artist;

/**
 * P12 Псевдоним `/artists/:id?tab=`: how much has this pseudonym earned, what waits and why, what was recouped and
 * charged, from which tracks, split rows and rules? `GET /artists/:id` (the card, reference) and one money call
 * `GET /artists/:id/balance` (the reach of the pseudonym, D-165; period in the URL), shared by the tabs. The payout is
 * the owner's (D-051): the card links to the owner.
 */
export function ArtistPage() {
  const id = useParams().id ?? '';
  const [period, setPeriod] = usePeriod();
  const detail = useQuery(artistQueries.detail(id));
  const balance = useQuery(artistQueries.balance(id, period));
  useBreadcrumbLabel(detail.data?.artist.pseudonym ?? id);
  return (
    <div data-testid="artist-page">
      <QueryView query={detail}>
        {(d) => (
          <div className="flex flex-col gap-3">
            {d.merged ? (
              <div data-testid="artist-merged" className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
                {t.merged} <EntityLink kind="artist" id={d.artist.id} label={d.artist.pseudonym} />. {t.mergedHint}
              </div>
            ) : null}
            <div data-testid="artist-header">
              <h1 className="text-2xl font-semibold" data-testid="artist-page-title">
                {d.artist.pseudonym}
              </h1>
              <p className="text-sm text-muted" data-testid="artist-page-subtitle">
                {t.owner}:{' '}
                <span data-testid="artist-owner">
                  {d.owner ? <EntityLink kind="owner" id={d.owner.id} label={d.owner.name} /> : t.noOwner}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p className="text-sm text-muted">{t.subtitle}</p>
              <PeriodBar period={period} onApply={setPeriod} />
            </div>
            <EntityCard
              title={<span data-testid="artist-name">{d.artist.pseudonym}</span>}
              chips={<StatusChip kind="artistStatus" value={d.artist.status} />}
              subtitle={
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    {t.owner}: {d.owner ? <EntityLink kind="owner" id={d.owner.id} label={d.owner.name} /> : t.noOwner}
                  </span>
                  {d.previousIds.length > 0 ? <span data-testid="artist-previous-ids">· {fmt(t.previousIds, { n: d.previousIds.length })}</span> : null}
                </span>
              }
              headline={
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2 text-lg" data-testid="artist-headline">
                    <StaleBadge show={balance.isFetching && balance.data !== undefined} />
                    {t.money.earned}: <Money value={balance.data?.total.earned} />
                  </div>
                  {d.owner === null ? <AssignOwnerAction artistId={d.artist.id} pseudonym={d.artist.pseudonym} /> : null}
                </div>
              }
              tabs={[
                {
                  id: 'balance',
                  label: t.tabs.balance,
                  content: (
                    <QueryView query={balance} money>
                      {(b) => <ArtistBalanceTab balance={b} />}
                    </QueryView>
                  ),
                },
                { id: 'rules', label: t.tabs.rules, content: <ArtistRulesTab detail={d} /> },
                { id: 'documents', label: t.tabs.documents, content: <ArtistDocumentsTab detail={d} /> },
                { id: 'ads', label: t.tabs.ads, content: <AdsOfEntity artistId={d.artist.id} pseudonym={d.artist.pseudonym} /> },
                { id: 'operations', label: t.tabs.operations, content: <ArtistOperationsTab artistId={d.artist.id} /> },
                { id: 'history', label: t.tabs.history, content: <ArtistHistoryTab artistId={d.artist.id} /> },
              ]}
            />
          </div>
        )}
      </QueryView>
    </div>
  );
}
