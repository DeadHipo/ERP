import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { documentQueries } from '../../../api/queries/documents';
import { ActionButton } from '../../../components/ActionButton';
import { useBreadcrumbLabel } from '../../../components/breadcrumb-label';
import { EntityLink } from '../../../components/EntityLink';
import { Money } from '../../../components/Money';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { StatusChip } from '../../../components/StatusChip';
import { ru } from '../../../i18n/ru';
import { CReasonList } from '../../catalog/components/CReasonList';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';
import { centsToText } from '../../owners/components/cents';
import { ApproveDocumentDialog, CreateContractDialog } from '../../work/actions/dialogs';
import { DocumentCell, OwnerLink, period, useArtistNames, useOwnerNames } from '../shared';
import { ApproveControl } from './DocumentsPage';
import { AttachDialog, ConfirmSplitWithDocumentDialog, SetDocumentLabelDialog, useDocumentLabelName } from './DocumentDialogs';

const t = ru.reference.documents;
const r = ru.catalog.rules;

function Section(props: { title: string; testId: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section data-testid={props.testId}>
      <h2 className="mb-2 text-sm font-medium">{props.title}</h2>
      {props.empty ? <p className="text-sm text-muted">{t.none}</p> : props.children}
    </section>
  );
}

/** P14 «Документ» `/documents/:id`: `GET /documents/:id/uses` (N13), the waiting money and the document's actions. */
export function DocumentPage() {
  const id = useParams().id ?? '';
  const names = useOwnerNames();
  const pseudonyms = useArtistNames();
  const query = useQuery(documentQueries.uses(id));
  const labelName = useDocumentLabelName();
  const [dialog, setDialog] = useState<'approve' | 'attach' | 'confirm-split' | 'contract' | 'label' | null>(null);
  useBreadcrumbLabel(query.data?.document.title ?? id);
  const close = () => setDialog(null);
  return (
    <div data-testid="document-page">
      <QueryView query={query} money>
        {(u) => {
          const d = u.document;
          return (
            <div className="flex flex-col gap-6">
              <PageHeader title={d.title} subtitle={t.detailSubtitle} />
              <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="document-header">
                <StatusChip kind="documentKind" value={d.kind} />
                <StatusChip kind="documentStatus" value={d.status} />
                <span>
                  {t.cols.owner}: <OwnerLink ownerId={d.ownerId} names={names} />
                </span>
                <span>
                  {t.file}: {d.fileRef ? <span data-testid="document-file">{d.fileRef}</span> : t.noFile}
                </span>
                <span className="flex items-center gap-2">
                  {t.cols.label}:{' '}
                  <span data-testid="document-label" data-label-id={d.labelId ?? ''}>
                    {labelName(d.labelId)}
                  </span>
                  <ActionButton name="set-document-label" variant="secondary" compact onPress={() => setDialog('label')}>
                    {t.setLabel}
                  </ActionButton>
                </span>
                {d.approvedAt ? <span data-testid="document-approved-at">{t.approvedAt}: {d.approvedAt.slice(0, 10)}</span> : null}
              </div>
              <div className="rounded-xl border border-border p-3" data-testid="document-waiting">
                <div className="text-sm text-muted">{t.waiting}</div>
                <div className="text-xl" data-testid="waiting-amount">
                  <Money value={u.waiting.amount} />
                </div>
                <CReasonList byReason={u.waiting.cByReason} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {d.status === 'not_attached' ? (
                  <ActionButton name="attach" variant="secondary" onPress={() => setDialog('attach')}>
                    {t.attach}
                  </ActionButton>
                ) : null}
                <ApproveControl doc={d} onApprove={() => setDialog('approve')} />
                {/* An assumption confirms nothing (its money waits in C assumption): it is only replaced by a document. */}
                {d.kind === 'assumption' ? null : (
                  <>
                    <ActionButton name="confirm-split" variant="secondary" onPress={() => setDialog('confirm-split')}>
                      {t.confirmSplit}
                    </ActionButton>
                    <ActionButton name="create-contract" variant="secondary" onPress={() => setDialog('contract')}>
                      {t.createContract}
                    </ActionButton>
                  </>
                )}
                {d.kind === 'assumption' ? (
                  <Link to={`/queue/assumption?q=${encodeURIComponent(d.title)}`} className="text-sm text-accent hover:underline" data-testid="link-assumption-wizard">
                    {t.assumptionWizard}
                  </Link>
                ) : null}
              </div>
              <Section title={t.splits} testId="uses-splits" empty={u.splits.length === 0}>
                <SimpleTable headers={[ru.reference.splits.cols.isrc, r.period, r.shares]}>
                  {u.splits.map((s) => (
                    <tr key={s.id} data-testid={`split-${s.id}`} className="border-t border-border">
                      <Td><EntityLink kind="isrc" id={s.isrc} /></Td>
                      <Td>{period(s.validFrom, s.validTo)}</Td>
                      <Td>
                        {s.shares.map((x, i) => (
                          <span key={x.artistId}>
                            {i > 0 ? ', ' : ''}
                            <EntityLink kind="artist" id={x.artistId} label={x.pseudonym} /> {x.percent} %
                          </span>
                        ))}
                      </Td>
                    </tr>
                  ))}
                </SimpleTable>
              </Section>
              <Section title={t.rowsOnly} testId="uses-rows-only" empty={u.rowsOnly.length === 0}>
                <SimpleTable headers={[ru.reference.splits.cols.isrc, ru.reference.splits.artist]}>
                  {u.rowsOnly.map((x) => (
                    <tr key={`${x.splitId}-${x.artistId}`} data-testid={`row-only-${x.splitId}-${x.artistId}`} className="border-t border-border">
                      <Td><EntityLink kind="isrc" id={x.isrc} /></Td>
                      <Td><EntityLink kind="artist" id={x.artistId} label={pseudonyms.get(x.artistId) ?? x.artistId} /></Td>
                    </tr>
                  ))}
                </SimpleTable>
              </Section>
              <Section title={t.participations} testId="uses-participations" empty={u.participations.length === 0}>
                <SimpleTable headers={[ru.reference.splits.cols.isrc, r.pseudonym, r.percent, r.period]}>
                  {u.participations.map((p) => (
                    <tr key={p.id} data-testid={`participation-${p.id}`} className="border-t border-border">
                      <Td><EntityLink kind="isrc" id={p.isrc} /></Td>
                      <Td><EntityLink kind="artist" id={p.artistId} label={p.pseudonym} /></Td>
                      <Td>{p.percent}</Td>
                      <Td>{period(p.validFrom, p.validTo)}</Td>
                    </tr>
                  ))}
                </SimpleTable>
              </Section>
              <Section title={t.labelRules} testId="uses-label-rules" empty={u.labelRules.length === 0}>
                <SimpleTable headers={[ru.reference.labels.cols.name, t.uses.recipient, t.uses.percent, t.uses.period, r.document]}>
                  {u.labelRules.map((x) => (
                    <tr key={x.id} data-testid={`label-rule-${x.id}`} className="border-t border-border">
                      <Td><EntityLink kind="label" id={x.labelId} /></Td>
                      <Td><EntityLink kind="artist" id={x.recipientArtistId} label={x.recipientPseudonym} /></Td>
                      <Td>{x.percent}</Td>
                      <Td>{period(x.validFrom, x.validTo)}</Td>
                      <Td><DocumentCell id={x.documentId} status={x.documentStatus} /></Td>
                    </tr>
                  ))}
                </SimpleTable>
              </Section>
              <Section title={t.contracts} testId="uses-contracts" empty={u.contracts.length === 0}>
                <SimpleTable headers={[t.uses.number, ru.reference.artists.title]}>
                  {u.contracts.map((c) => (
                    <tr key={c.id} data-testid={`contract-${c.id}`} className="border-t border-border">
                      <Td>{c.number ?? c.id}</Td>
                      <Td>{c.artistIds.map((a) => <EntityLink key={a} kind="artist" id={a} label={pseudonyms.get(a) ?? a} />).flatMap((x, i) => (i === 0 ? [x] : [', ', x]))}</Td>
                    </tr>
                  ))}
                </SimpleTable>
              </Section>
              <Section title={t.operations} testId="uses-operations" empty={u.operations.length === 0}>
                <SimpleTable headers={[t.uses.date, t.uses.meaning, t.uses.owner, t.uses.amount]}>
                  {u.operations.map((o) => (
                    <tr key={o.id} data-testid={`operation-${o.id}`} className="border-t border-border">
                      <Td>{o.date}</Td>
                      <Td><StatusChip kind="operationMeaning" value={o.meaning} /></Td>
                      <Td><OwnerLink ownerId={o.ownerId} names={names} /></Td>
                      <Td col="amount"><Money value={centsToText(o.amountCents)} /></Td>
                    </tr>
                  ))}
                </SimpleTable>
              </Section>
              {dialog === 'approve' ? <ApproveDocumentDialog documentId={d.id} doc={d} onClose={close} /> : null}
              {dialog === 'label' ? <SetDocumentLabelDialog doc={d} onClose={close} /> : null}
              {dialog === 'attach' ? <AttachDialog documentId={d.id} title={d.title} onClose={close} /> : null}
              {dialog === 'confirm-split' ? <ConfirmSplitWithDocumentDialog documentId={d.id} title={d.title} onClose={close} /> : null}
              {dialog === 'contract' ? <CreateContractDialog
                  document={{ id: d.id, title: d.title }}
                  ownerId={d.ownerId ?? undefined}
                  ownerLabel={d.ownerId ? names.get(d.ownerId) : undefined}
                  onClose={close}
                /> : null}
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
