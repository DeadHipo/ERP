import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { AdView } from '@erp/shared/api-responses';
import { adQueries } from '../../api/queries/ads';
import { ActionButton } from '../../components/ActionButton';
import { AuditTable } from '../../components/AuditTable';
import { useBreadcrumbLabel } from '../../components/breadcrumb-label';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { PageHeader } from '../../components/PageHeader';
import { QueryView } from '../../components/PageState';
import { useOwnLabels } from '../../components/LabelSwitch';
import { formatDateTime } from '../../lib/datetime';
import { ru } from '../../i18n/ru';
import { centsToText } from '../owners/components/cents';
import { Fact, Section, SimpleTable, Td } from '../owners/components/Fact';
import { DeactivateAdDialog, EditAdDialog } from './AdDialogs';

const t = ru.ads;
const d = t.detail;

/** P22 «Расход» `/ads/:id`: one record, who bears it, and who changed it. */
export function AdPage() {
  const id = useParams().id ?? '';
  const query = useQuery(adQueries.detail(id));
  const name = query.data ? `${query.data.month} · ${query.data.isrc ?? '—'}` : id;
  useBreadcrumbLabel(name);
  return (
    <div data-testid="ad-page">
      <QueryView query={query} money>
        {(ad) => <AdCard ad={ad} title={name} />}
      </QueryView>
    </div>
  );
}

function Text(props: { testId: string; label: string; children: React.ReactNode }) {
  return (
    <Fact testId={props.testId} label={props.label}>
      {props.children}
    </Fact>
  );
}

function AdCard({ ad, title }: { ad: AdView; title: string }) {
  const [dialog, setDialog] = useState<'edit' | 'deactivate' | null>(null);
  const audit = useQuery(adQueries.audit(ad.id));
  const a = ad.allocation;
  const own = useOwnLabels();
  // the payer (D-169) is the label of the record; the income book of the ISRC that month is shown when it differs
  const payer = ad.labelId ? (a?.ourLabelName ?? own.find((l) => l.id === ad.labelId)?.name ?? ad.labelId) : t.noPayer;
  const otherBook = a?.incomeBookLabelName && a.incomeBookLabelId !== ad.labelId ? a.incomeBookLabelName : null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title}
        subtitle={d.subtitle}
        toolbar={
          ad.active ? (
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton name="ad-edit" variant="secondary" onPress={() => setDialog('edit')}>
                {t.edit.open}
              </ActionButton>
              <ActionButton name="ad-deactivate" variant="danger" onPress={() => setDialog('deactivate')}>
                {t.deactivate.open}
              </ActionButton>
            </div>
          ) : null
        }
      />
      {ad.active ? null : (
        <div className="text-sm text-danger" data-testid="ad-inactive">
          {d.inactive} {ad.deactivatedReason ? `${d.reason}: ${ad.deactivatedReason}` : ''}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={d.subtitle} testId="ad-facts">
          <Fact testId="ad-amount" label={d.amount} value={centsToText(ad.amountCents)} strong />
          <Text testId="ad-percent" label={d.percent}>{ad.recoveryPercent} %</Text>
          <Text testId="ad-scope" label={d.scope}>{t.scopes[ad.scope]}</Text>
          <Text testId="ad-status" label={d.status}>{a ? t.status[a.status] : t.inactive}</Text>
          <Text testId="ad-label" label={d.label}>
            <span data-label-id={ad.labelId ?? ''} className={ad.labelId ? '' : 'text-danger'}>{payer}</span>
          </Text>
          {otherBook ? (
            <Text testId="ad-income-book" label={d.incomeBook}>
              <span title={d.incomeBookHint}>{otherBook}</span>
            </Text>
          ) : null}
          {a?.sublabelName ? <Text testId="ad-sublabel" label={d.sublabel}>{a.sublabelName}</Text> : null}
          <Text testId="ad-source" label={d.source}>{ad.migration ? t.migration : ad.source}</Text>
          {ad.externalRef ? <Text testId="ad-ref" label={d.ref}><span className="break-all">{ad.externalRef}</span></Text> : null}
          {ad.comment ? <Text testId="ad-comment" label={d.comment}>{ad.comment}</Text> : null}
          <Text testId="ad-created" label={d.created}>{formatDateTime(ad.createdAt)}</Text>
          {ad.isrc ? <Text testId="ad-isrc" label="ISRC"><EntityLink kind="isrc" id={ad.isrc} /></Text> : null}
        </Section>
        {a ? (
          <Section title={d.parts} testId="ad-parts">
            {a.parts.length === 0 ? (
              <span className="text-sm text-muted">{d.noParts}</span>
            ) : (
              <SimpleTable head={[d.partCols.pseudonym, d.partCols.weight, d.partCols.amount, d.partCols.recovered]}>
                {a.parts.map((p) => (
                  <tr key={p.artistId} data-testid={`ad-part-${p.artistId}`}>
                    <Td>
                      <EntityLink kind="artist" id={p.artistId} label={p.pseudonym} />
                    </Td>
                    <Td col="weight">{p.weight}</Td>
                    <Td col="amount">
                      <Money value={p.amount} />
                    </Td>
                    <Td col="recovered">
                      <Money value={p.recovered} />
                    </Td>
                  </tr>
                ))}
              </SimpleTable>
            )}
            <Fact testId="ad-unrecovered" label={d.unrecovered} value={a.unrecovered} />
            <Text testId="ad-borne" label={d.borne}>
              {a.borneBy.kind === 'sublabel' ? (
                <EntityLink kind="artist" id={a.borneBy.artistId} label={a.sublabelName ?? a.borneBy.artistId} />
              ) : (
                t.borneUs
              )}
            </Text>
          </Section>
        ) : null}
      </div>
      <Section title={d.history} testId="ad-history">
        <QueryView query={audit} isEmpty={(x) => x.items.length === 0} emptyMessage={ru.audit.empty}>
          {(x) => <AuditTable items={x.items} testId="ad-audit" />}
        </QueryView>
      </Section>
      {dialog === 'edit' ? <EditAdDialog ad={ad} onClose={() => setDialog(null)} /> : null}
      {dialog === 'deactivate' ? <DeactivateAdDialog ad={ad} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
