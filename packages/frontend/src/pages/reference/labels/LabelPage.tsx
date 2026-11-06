import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LabelListItem } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { labelQueries } from '../../../api/queries/labels';
import { ActionButton } from '../../../components/ActionButton';
import { useBreadcrumbLabel } from '../../../components/breadcrumb-label';
import { EntityLink } from '../../../components/EntityLink';
import { FormDialog } from '../../../components/FormDialog';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { SimpleTable, Td } from '../../catalog/components/MoneyTable';
import { AddAccountDialog, RemoveAccountDialog } from './AccountDialogs';
import { CloseRuleDialog, SetRuleDialog } from '../../work/actions/dialogs';
import { DocumentCell, period } from '../shared';

const t = ru.reference.labels;
type Rule = LabelListItem['rules'][number];

function AddAliasDialog(props: { label: LabelListItem; onClose: () => void }) {
  const [alias, setAlias] = useState('');
  const run = useAction(() => api.labels.addAlias(props.label.id, { alias: alias.trim() }), {
    invalidate: 'all',
    success: (l) => fmt(t.aliasAdded, { alias: alias.trim(), label: l.name }),
  });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.addAlias}
      footer={
        <ActionButton name="alias-submit" op="POST /labels/:id/aliases" isPending={run.isPending} isDisabled={alias.trim() === ''} reason={ru.actions.hints.fillFields} onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}>
          {t.addAlias}
        </ActionButton>
      }
    >
      <TextField name="label-alias" label={t.aliasField} value={alias} onChange={setAlias} isRequired />
    </FormDialog>
  );
}

/** P17 «Лейбл» `/labels/:id`: aliases, accounts and rules of one label; add alias, add account, set rule, close rule. */
export function LabelPage() {
  const id = useParams().id ?? '';
  const query = useQuery(labelQueries.list());
  const label = query.data?.find((l) => l.id === id);
  const [dialog, setDialog] = useState<{ kind: 'alias' } | { kind: 'account' } | { kind: 'remove'; account: string } | { kind: 'rule' } | { kind: 'close'; rule: Rule } | null>(null);
  useBreadcrumbLabel(label?.name ?? id);
  const close = () => setDialog(null);
  return (
    <div data-testid="label-page">
      <QueryView query={query}>
        {(all) => {
          const l = all.find((x) => x.id === id);
          if (!l) return <p className="text-sm text-muted" data-testid="label-missing">{ru.common.notFound}</p>;
          const own = l.ownLabelId ? all.find((x) => x.id === l.ownLabelId) : undefined;
          return (
            <div className="flex flex-col gap-6">
              <PageHeader title={l.name} subtitle={t.detailSubtitle} />
              <div className="flex flex-wrap gap-4 text-sm" data-testid="label-header">
                <span data-testid="label-kind">{t.kind[l.kind]}</span>
                {own ? (
                  <span>
                    {t.ownerOf}: <EntityLink kind="label" id={own.id} label={own.name} />
                  </span>
                ) : null}
              </div>
              <section>
                <div className="mb-2 flex items-center gap-3">
                  <h2 className="text-sm font-medium">{t.aliases}</h2>
                  <ActionButton name="add-alias" op="POST /labels/:id/aliases" variant="secondary" onPress={() => setDialog({ kind: 'alias' })}>
                    {t.addAlias}
                  </ActionButton>
                </div>
                {l.aliases.length === 0 ? (
                  <p className="text-sm text-muted">{t.noAliases}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2" data-testid="label-aliases">
                    {l.aliases.map((a) => (
                      <li key={a} data-testid={`alias-${a}`} className="rounded-lg border border-border px-2 py-1 text-sm">
                        {a}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {l.kind === 'own' ? (
                <section>
                  <div className="mb-2 flex items-center gap-3">
                    <h2 className="text-sm font-medium">{t.accounts}</h2>
                    <ActionButton name="add-account" op="POST /labels/:id/accounts" variant="secondary" onPress={() => setDialog({ kind: 'account' })}>
                      {t.addAccount}
                    </ActionButton>
                  </div>
                  {l.accounts.length === 0 ? (
                    <p className="text-sm text-muted">{t.noAccounts}</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2" data-testid="label-accounts">
                      {l.accounts.map((acc) => (
                        <li key={acc} data-testid={`account-${acc}`} className="flex items-center gap-2 rounded-lg border border-border px-2 py-1 text-sm">
                          {acc}
                          <ActionButton name={`remove-account-${acc}`} op="POST /labels/:id/accounts/:account/remove" variant="tertiary" compact onPress={() => setDialog({ kind: 'remove', account: acc })}>
                            {t.removeAccount}
                          </ActionButton>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
              <section>
                <div className="mb-2 flex items-center gap-3">
                  <h2 className="text-sm font-medium">{t.rules}</h2>
                  {l.kind === 'sublabel' ? (
                    <ActionButton name="set-rule" op="POST /labels/:id/rules" variant="secondary" onPress={() => setDialog({ kind: 'rule' })}>
                      {t.setRule}
                    </ActionButton>
                  ) : null}
                </div>
                {l.rules.length === 0 ? (
                  <p className="text-sm text-muted">{t.noRules}</p>
                ) : (
                  <SimpleTable testId="label-rules" headers={[t.ruleCols.recipient, t.ruleCols.percent, t.ruleCols.period, t.ruleCols.document, t.ruleCols.actions]}>
                    {l.rules.map((x) => (
                      <tr key={x.id} data-testid={`label-rule-${x.id}`} className="border-t border-border">
                        <Td col="recipient"><EntityLink kind="artist" id={x.recipientArtistId} label={x.recipientPseudonym} /></Td>
                        <Td col="percent">{x.percent}</Td>
                        <Td col="period">{period(x.validFrom, x.validTo)}</Td>
                        <Td col="document"><DocumentCell id={x.documentId} status={x.documentStatus} /></Td>
                        <Td>
                          <ActionButton name="close-rule" op="POST /labels/rules/:id/close" variant="secondary" onPress={() => setDialog({ kind: 'close', rule: x })}>
                            {t.closeRule}
                          </ActionButton>
                        </Td>
                      </tr>
                    ))}
                  </SimpleTable>
                )}
              </section>
              {dialog?.kind === 'alias' ? <AddAliasDialog label={l} onClose={close} /> : null}
              {dialog?.kind === 'account' ? <AddAccountDialog label={l} onClose={close} /> : null}
              {dialog?.kind === 'remove' ? <RemoveAccountDialog label={l} account={dialog.account} onClose={close} /> : null}
              {dialog?.kind === 'rule' ? <SetRuleDialog labelString={l.name} month="" onClose={close} /> : null}
              {dialog?.kind === 'close' ? <CloseRuleDialog labelId={l.id} ruleId={dialog.rule.id} onClose={close} /> : null}
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
