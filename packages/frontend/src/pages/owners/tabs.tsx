import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Balance, OwnerDetail } from '@erp/shared/api-responses';
import { usePublishingV2 } from '../../api/queries/auth';
import { ownerQueries } from '../../api/queries/owners';
import { settlementQueries } from '../../api/queries/settlements';
import { ActionButton } from '../../components/ActionButton';
import { AuditTable } from '../../components/AuditTable';
import { EntityLink } from '../../components/EntityLink';
import { Money } from '../../components/Money';
import { QueryView } from '../../components/PageState';
import { StatusChip } from '../../components/StatusChip';
import { ru } from '../../i18n/ru';
import { PublishingTermsDialog } from '../work/actions/dialogs';
import { useWriteLabel } from '../../lib/label';
import { CreateOperationDialog } from '../operations/CreateOperationDialog';
import { OperationsGrid } from '../operations/OperationsGrid';
import { Section, SimpleTable, Td } from './components/Fact';

const m = ru.money;

/** P10 Псевдонимы и треки: the owner's pseudonyms with their tracks, each a link. */
export function ArtistsTab(props: { detail: OwnerDetail }) {
  const artists = props.detail.artists;
  if (artists.length === 0) return <span className="text-sm text-muted">{m.artists.empty}</span>;
  return (
    <div className="flex flex-col gap-3" data-testid="artists-tab">
      {artists.map((a) => (
        <Section key={a.id} title={a.pseudonym} testId={`artist-${a.id}`} toolbar={<StatusChip kind="artistStatus" value={a.status} />}>
          <div className="text-sm">
            <EntityLink kind="artist" id={a.id} label={a.pseudonym} />
          </div>
          {a.tracks.length === 0 ? (
            <span className="text-sm text-muted">{m.artists.noTracks}</span>
          ) : (
            <ul className="flex flex-wrap gap-3 text-sm">
              {a.tracks.map((tr) => (
                <li key={tr.id} data-testid={`artist-track-${tr.isrc ?? tr.id}`}>
                  {tr.isrc ? <EntityLink kind="isrc" id={tr.isrc} label={`${tr.isrc} · ${tr.title}`} /> : tr.title}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ))}
    </div>
  );
}

/**
 * P10 Паблишинг: the terms by operation type (set terms) and the publishing lines of the balance. The lines are those of
 * the book in view (D-169: a B17 line sits in the book of the label of its statement; under «Все» every book).
 */
export function PublishingTab(props: { detail: OwnerDetail; balance: Balance | undefined }) {
  const [open, setOpen] = useState(false);
  const v2 = usePublishingV2(); // D-194: the dialog writes the terms of v2
  const p = m.publishing;
  const b = m.balance;
  return (
    <div className="flex flex-col gap-4" data-testid="publishing-tab">
      <Section
        title={p.terms}
        toolbar={
          <ActionButton name="publishing-terms" op={v2 ? 'POST /publishing-v2/terms' : 'POST /publishing/terms'} variant="secondary" onPress={() => setOpen(true)}>
            {p.set}
          </ActionButton>
        }
      >
        {props.detail.publishingTerms.length === 0 ? (
          <span className="text-sm text-muted">{p.empty}</span>
        ) : (
          <SimpleTable head={[p.cols.percent, p.cols.from, p.cols.to, p.cols.type, p.cols.document]}>
            {props.detail.publishingTerms.map((x) => (
              <tr key={x.id} data-testid={`terms-${x.id}`}>
                <Td>{x.percent} %</Td>
                <Td>{x.validFrom}</Td>
                <Td>{x.validTo ?? '—'}</Td>
                <Td>{x.operationType ?? p.allTypes}</Td>
                <Td>{x.documentId ? <EntityLink kind="document" id={x.documentId} label="→" /> : '—'}</Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
      {props.balance && props.balance.publishing.length > 0 ? (
        <Section title={b.publishingLines}>
          <SimpleTable head={[b.period, b.workTitle, b.amount, b.percent, b.category, b.reason]}>
            {props.balance.publishing.map((x, i) => (
              <tr key={`${x.period}-${x.workTitle}-${i}`} data-testid="publishing-line" data-period={x.period}>
                <Td col="period">{x.period}</Td>
                <Td col="workTitle">{x.workTitle}</Td>
                <Td col="amount">
                  <Money value={x.amount} />
                </Td>
                <Td>{x.percent} %</Td>
                <Td col="category">{x.category}</Td>
                <Td>{x.reason ? (ru.reasons[x.reason as keyof typeof ru.reasons] ?? x.reason) : ''}</Td>
              </tr>
            ))}
          </SimpleTable>
        </Section>
      ) : null}
      {open ? (
        <PublishingTermsDialog ownerId={props.detail.owner.id} ownerLabel={props.detail.owner.name} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}

/** P10 Операции: the owner's operations (`GET /settlements/operations?ownerId=`, under the label those of it, D-168) and «Аванс / вычет / кредит». */
export function OperationsTab(props: { detail: OwnerDetail; balance: Balance | undefined; labelId?: string }) {
  const query = useQuery(settlementQueries.operations({ ownerId: props.detail.owner.id, ...(props.labelId ? { label: props.labelId } : {}) }));
  const [open, setOpen] = useState(false);
  const write = useWriteLabel(); // an operation is written under a label (D-168): closed under «Все»
  return (
    <div className="flex flex-col gap-3" data-testid="operations-tab">
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton name="create-operation" op="POST /settlements/operations" isDisabled={write.closed} reason={write.closed ? write.reason : undefined} onPress={() => setOpen(true)}>
          {m.actions.create}
        </ActionButton>
        {props.balance && props.balance.blockingPayouts.length > 0 ? (
          <span className="text-sm text-warning" data-testid="operations-blocked">
            {m.operations.blockedNote}
          </span>
        ) : null}
      </div>
      <QueryView query={query} isEmpty={(d) => d.length === 0} emptyMessage={m.operations.empty}>
        {(rows) => <OperationsGrid rows={rows} showOwner={false} />}
      </QueryView>
      {open ? <CreateOperationDialog detail={props.detail} existing={query.data ?? []} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

/** P10 История: the audit trail of writes that touched the owner (`GET /audit?entityId=`). */
export function HistoryTab(props: { ownerId: string }) {
  const query = useQuery(ownerQueries.audit(props.ownerId));
  return (
    <div data-testid="history-tab">
      <QueryView query={query} isEmpty={(d) => d.items.length === 0} emptyMessage={ru.audit.empty}>
        {(data) => <AuditTable items={data.items} />}
      </QueryView>
    </div>
  );
}
