import { useState } from 'react';
import type { DocumentView, OwnerDetail } from '@erp/shared/api-responses';
import * as api from '../../api/client';
import { useAction } from '../../api/queries/core';
import { ActionButton } from '../../components/ActionButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EntityLink } from '../../components/EntityLink';
import { FormDialog } from '../../components/FormDialog';
import { StatusChip } from '../../components/StatusChip';
import { TextField } from '../../components/fields/TextField';
import { useOperator } from '../../lib/operator';
import { fmt, ru } from '../../i18n/ru';
import { DocumentStep, type ReadyDocument } from '../work/actions/DocumentStep';
import { useApproveLines } from '../work/actions/approve-lines';
import { ContractDialog } from './components/ContractDialog';
import { Section, SimpleTable, Td } from './components/Fact';

const t = ru.money.documents;
const ALL_KINDS = ['contract', 'appendix', 'buyout', 'advance_basis', 'adjustment_basis', 'payment_proof', 'return_proof', 'other'] as const;

type Active = { action: 'create' | 'contract' } | { action: 'attach' | 'approve'; doc: DocumentView };

/** P10 Документы и договоры: the owner's documents and contracts; create, attach, approve, create a contract. */
export function DocumentsTab(props: { detail: OwnerDetail }) {
  const d = props.detail;
  const [active, setActive] = useState<Active | null>(null);
  const titleOf = (id: string) => d.documents.find((x) => x.id === id)?.title ?? id;
  const pseudonymOf = (id: string) => d.artists.find((x) => x.id === id)?.pseudonym ?? id;
  return (
    <div className="flex flex-col gap-4" data-testid="documents-tab">
      <Section
        title={t.documents}
        toolbar={
          <ActionButton name="create-document" variant="secondary" onPress={() => setActive({ action: 'create' })}>
            {t.create}
          </ActionButton>
        }
      >
        {d.documents.length === 0 ? (
          <span className="text-sm text-muted">{t.empty}</span>
        ) : (
          <SimpleTable head={[t.cols.title, t.cols.kind, t.cols.status, t.cols.actions]}>
            {d.documents.map((doc) => (
              <tr key={doc.id} data-testid={`document-${doc.id}`}>
                <Td>
                  <EntityLink kind="document" id={doc.id} label={doc.title} />
                </Td>
                <Td>
                  <StatusChip kind="documentKind" value={doc.kind} />
                </Td>
                <Td>
                  <StatusChip kind="documentStatus" value={doc.status} />
                </Td>
                <Td>
                  {doc.status === 'not_attached' ? (
                    <ActionButton name="attach" variant="secondary" onPress={() => setActive({ action: 'attach', doc })}>
                      {t.attach}
                    </ActionButton>
                  ) : null}
                  {doc.status === 'not_approved' && doc.kind !== 'assumption' ? (
                    <ActionButton name="approve" variant="secondary" onPress={() => setActive({ action: 'approve', doc })}>
                      {t.approve}
                    </ActionButton>
                  ) : null}
                  {doc.kind === 'assumption' ? <span className="text-xs text-muted">{t.assumption}</span> : null}
                </Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
      <Section
        title={t.contracts}
        toolbar={
          <ActionButton name="create-contract" variant="secondary" onPress={() => setActive({ action: 'contract' })}>
            {t.contract}
          </ActionButton>
        }
      >
        {d.contracts.length === 0 ? (
          <span className="text-sm text-muted">{t.contractsEmpty}</span>
        ) : (
          <SimpleTable head={[t.cols.number, t.cols.document, t.cols.artists]}>
            {d.contracts.map((c) => (
              <tr key={c.id} data-testid={`contract-${c.id}`}>
                <Td>{c.number ?? '—'}</Td>
                <Td>
                  <EntityLink kind="document" id={c.documentId} label={titleOf(c.documentId)} />
                </Td>
                <Td>{c.artistIds.map(pseudonymOf).join(', ')}</Td>
              </tr>
            ))}
          </SimpleTable>
        )}
      </Section>
      {active?.action === 'create' ? <CreateDocumentDialog detail={d} onClose={() => setActive(null)} /> : null}
      {active?.action === 'contract' ? <ContractDialog detail={d} onClose={() => setActive(null)} /> : null}
      {active?.action === 'attach' ? <AttachDialog doc={active.doc} onClose={() => setActive(null)} /> : null}
      {active?.action === 'approve' ? <ApproveDialog doc={active.doc} onClose={() => setActive(null)} /> : null}
    </div>
  );
}

function CreateDocumentDialog(props: { detail: OwnerDetail; onClose: () => void }) {
  const [doc, setDoc] = useState<ReadyDocument | null>(null);
  return (
    <FormDialog isOpen onOpenChange={(o) => (o ? null : props.onClose())} title={t.createTitle}>
      <DocumentStep
        kinds={ALL_KINDS}
        newOnly
        ownerId={props.detail.owner.id}
        defaultTitle={`Документ ${props.detail.owner.name}`}
        ready={doc}
        onReady={setDoc}
      />
    </FormDialog>
  );
}

function AttachDialog(props: { doc: DocumentView; onClose: () => void }) {
  const [fileRef, setFileRef] = useState('');
  const run = useAction(() => api.documents.attach(props.doc.id, { fileRef: fileRef.trim() }), {
    invalidate: 'all',
    success: (d) => fmt(t.attached, { title: d.title }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.attachTitle}
      subtitle={props.doc.title}
      footer={
        <ActionButton name="attach-submit" isDisabled={fileRef.trim() === ''} isPending={run.isPending} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}>
          {t.attach}
        </ActionButton>
      }
    >
      <TextField name="attach-file" label={t.fileRef} value={fileRef} onChange={setFileRef} isRequired />
    </FormDialog>
  );
}

function ApproveDialog(props: { doc: DocumentView; onClose: () => void }) {
  const { operator } = useOperator();
  const lines = useApproveLines(props.doc, undefined, true);
  const run = useAction(() => api.documents.approve(props.doc.id, { by: operator }), {
    invalidate: 'all',
    success: (d) => fmt(ru.actions.toast.approved, { title: d.title }),
  });
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={ru.actions.confirm.approveTitle}
      lines={lines}
      isPending={run.isPending}
      onConfirm={() => run.mutate(undefined, { onSettled: props.onClose })}
    />
  );
}
