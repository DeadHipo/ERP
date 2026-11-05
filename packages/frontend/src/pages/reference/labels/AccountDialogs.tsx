import { useState } from 'react';
import * as api from '../../../api/client';
import { useAction } from '../../../api/queries/core';
import { ActionButton } from '../../../components/ActionButton';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FormDialog } from '../../../components/FormDialog';
import { TextField } from '../../../components/fields/TextField';
import { fmt, ru } from '../../../i18n/ru';

const t = ru.reference.labels;

/**
 * «Добавить счёт» (D-168): a Believe account registered under an own label → `POST /labels/:id/accounts`. One dialog for
 * P17 and P19: with `account` (P19, the upload answered `account_unregistered`, D-169) the number is prefilled and the
 * title names the account and the label; `onAdded` then repeats the upload.
 */
export function AddAccountDialog(props: {
  label: { id: string; name: string };
  account?: string;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const [account, setAccount] = useState(props.account ?? '');
  const run = useAction(() => api.labels.addAccount(props.label.id, { account: account.trim() }), {
    invalidate: 'all',
    success: (l) => fmt(t.accountAdded, { account: account.trim(), label: l.name }),
  });
  const register = props.account !== undefined;
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={register ? fmt(t.registerAccount, { account: props.account ?? '', label: props.label.name }) : t.addAccount}
      subtitle={register ? t.registerHint : t.accountsHint}
      footer={
        <ActionButton
          name="account-submit"
          isPending={run.isPending}
          isDisabled={account.trim() === ''}
          reason={ru.actions.hints.fillFields}
          onPress={() =>
            run.mutate(undefined, {
              onSuccess: () => {
                props.onClose();
                props.onAdded?.();
              },
            })
          }
        >
          {t.addAccount}
        </ActionButton>
      }
    >
      <div className="flex flex-col gap-3" data-testid={register ? 'register-account-dialog' : 'add-account-dialog'}>
        <TextField name="label-account" label={t.accountField} value={account} onChange={setAccount} isRequired />
      </div>
    </FormDialog>
  );
}

/** «Снять счёт» (D-169): `POST /labels/:id/accounts/:account/remove`; refused with `account_has_files` while files of it exist. */
export function RemoveAccountDialog(props: { label: { id: string; name: string }; account: string; onClose: () => void }) {
  const run = useAction(() => api.labels.removeAccount(props.label.id, props.account), {
    invalidate: 'all',
    success: (l) => fmt(t.accountRemoved, { account: props.account, label: l.name }),
  });
  return (
    <ConfirmDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={t.removeAccount}
      lines={[fmt(t.removeLines.account, { account: props.account, label: props.label.name }), t.removeLines.files]}
      isPending={run.isPending}
      confirmLabel={t.removeAccount}
      onConfirm={() => run.mutate(undefined, { onSettled: props.onClose })}
    />
  );
}
