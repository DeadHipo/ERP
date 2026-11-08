import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ownerQueries } from '../../api/queries/owners';
import { ActionButton } from '../../components/ActionButton';
import { EntityCard } from '../../components/EntityCard';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { QueryView, StaleBadge } from '../../components/PageState';
import { StatusChip } from '../../components/StatusChip';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { fmt, ru } from '../../i18n/ru';
import { useLabel } from '../../lib/label';
import { usePeriod } from '../work/OverviewPage';
import { BalanceTab } from './BalanceTab';
import { AdmissionTab } from './AdmissionTab';
import { OwnerCuts } from './OwnerCuts';
import { DocumentsTab } from './DocumentsTab';
import { MergeOwnerDialog } from '../work/actions/dialogs';
import { AsOfField, asOfQuery, useAsOf } from './components/AsOfField';
import { PeriodBar } from './components/PeriodBar';
import { ArtistsTab, HistoryTab, OperationsTab, PublishingTab } from './tabs';

const t = ru.money.owner;

/**
 * P10 Владелец `/owners/:id?tab=`: how much has this owner earned, what waits and why, what was paid and recouped,
 * and can I pay now? `GET /owners/:id` (reference) and one money call `GET /owners/:id/balance` (period in the URL),
 * shared by the tabs.
 */
export function OwnerPage() {
  const id = useParams().id ?? '';
  const [period, setPeriod] = usePeriod();
  // the label view (D-168): the money and the operations of that label; the card stays whole
  const { labelId } = useLabel();
  const detail = useQuery(ownerQueries.detail(id));
  // the cut at the end of a month (D-173): an input of the same one money call
  const [asOf] = useAsOf();
  const moneyPeriod = { ...period, ...asOfQuery(asOf) };
  const balance = useQuery(ownerQueries.balance(id, moneyPeriod, labelId));
  const [merging, setMerging] = useState(false);
  useBreadcrumbLabel(detail.data?.owner.name);
  return (
    <div data-testid="owner-page">
      <QueryView query={detail}>
        {(d) => {
          // The API resolves a merged owner to the surviving one: a different id in the answer means "merged".
          const merged = d.owner.id !== id;
          return (
            <div className="flex flex-col gap-3">
              {merged ? (
                <div data-testid="owner-merged" className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
                  {t.merged} <EntityLink kind="owner" id={d.owner.id} label={d.owner.name} />. {t.mergedHint}
                </div>
              ) : null}
              <div>
                <h1 className="text-2xl font-semibold" data-testid="owner-page-title">
                  {d.owner.name}
                </h1>
                <p className="text-sm text-muted" data-testid="owner-page-subtitle">
                  {t.pseudonyms}: {d.artists.length === 0 ? '—' : d.artists.map((a) => a.pseudonym).join(', ')}
                </p>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <p className="text-sm text-muted">{t.subtitle}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <PeriodBar period={period} onApply={setPeriod} />
                  <AsOfField />
                </div>
              </div>
              <OwnerCuts ownerId={d.owner.id} labelId={labelId} />
              <EntityCard
                title={<span data-testid="owner-name">{d.owner.name}</span>}
                chips={<StatusChip kind="ownerStatus" value={d.owner.status} />}
                subtitle={
                  <span className="flex flex-wrap items-center gap-2">
                    <span>{ru.money.owners.kind[d.owner.kind]}</span>
                    <span>· {fmt(t.aliases, { n: d.owner.aliases.length })}</span>
                    <span data-testid="owner-pseudonyms">
                      · {t.pseudonyms}:{' '}
                      {d.artists.length === 0
                        ? '—'
                        : d.artists.map((a, i) => (
                            <span key={a.id}>
                              {i > 0 ? ', ' : ''}
                              <EntityLink kind="artist" id={a.id} label={a.pseudonym} />
                            </span>
                          ))}
                    </span>
                  </span>
                }
                headline={
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2 text-lg" data-testid="owner-headline">
                      <StaleBadge show={balance.isFetching && balance.data !== undefined} />
                      {ru.money.balance.payable}: <Money value={balance.data?.total.payableShown} />
                    </div>
                    {merged ? null : (
                      <ActionButton name="merge" op="POST /owners/merge" variant="secondary" onPress={() => setMerging(true)}>
                        {t.merge}
                      </ActionButton>
                    )}
                  </div>
                }
                tabs={[
                  {
                    id: 'balance',
                    label: t.tabs.balance,
                    content: (
                      <QueryView query={balance} money>
                        {(b) => <BalanceTab ownerId={d.owner.id} balance={b} period={moneyPeriod} />}
                      </QueryView>
                    ),
                  },
                  { id: 'artists', label: t.tabs.artists, content: <ArtistsTab detail={d} /> },
                  { id: 'documents', label: t.tabs.documents, content: <DocumentsTab detail={d} /> },
                  { id: 'publishing', label: t.tabs.publishing, content: <PublishingTab detail={d} balance={balance.data} /> },
                  { id: 'operations', label: t.tabs.operations, content: <OperationsTab detail={d} balance={balance.data} labelId={labelId} /> },
                  { id: 'admission', label: t.tabs.admission, content: <AdmissionTab detail={d} balance={balance.data} labelId={labelId} /> },
                  { id: 'history', label: t.tabs.history, content: <HistoryTab ownerId={d.owner.id} /> },
                ]}
              />
              {merging ? <MergeOwnerDialog ownerId={d.owner.id} ownerLabel={d.owner.name} openTarget onClose={() => setMerging(false)} /> : null}
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
