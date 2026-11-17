import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { LabelListItem } from '@erp/shared/api-responses';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { labelQueries } from '../../../api/queries/labels';
import { ActionButton } from '../../../components/ActionButton';
import { useBreadcrumbLabel } from '../../../components/breadcrumb-label';
import { FormDialog } from '../../../components/FormDialog';
import { PageHeader } from '../../../components/PageHeader';
import { QueryView } from '../../../components/PageState';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';
import { AddAccountDialog, RemoveAccountDialog } from './AccountDialogs';

const t = ru.reference.labels;

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

/** P17 «Лейбл» `/labels/:id`: the Believe strings and accounts of one own label (D-232: no rules). */
export function LabelPage() {
  const id = useParams().id ?? '';
  const query = useQuery(labelQueries.list());
  const label = query.data?.find((l) => l.id === id);
  const [dialog, setDialog] = useState<{ kind: 'alias' } | { kind: 'account' } | { kind: 'remove'; account: string } | null>(null);
  useBreadcrumbLabel(label?.name ?? id);
  const close = () => setDialog(null);
  return (
    <div data-testid="label-page">
      <QueryView query={query}>
        {(all) => {
          const l = all.find((x) => x.id === id);
          if (!l) return <p className="text-sm text-muted" data-testid="label-missing">{ru.common.notFound}</p>;
          return (
            <div className="flex flex-col gap-6">
              <PageHeader title={l.name} subtitle={t.detailSubtitle} />
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
              {dialog?.kind === 'alias' ? <AddAliasDialog label={l} onClose={close} /> : null}
              {dialog?.kind === 'account' ? <AddAccountDialog label={l} onClose={close} /> : null}
              {dialog?.kind === 'remove' ? <RemoveAccountDialog label={l} account={dialog.account} onClose={close} /> : null}
            </div>
          );
        }}
      </QueryView>
    </div>
  );
}
