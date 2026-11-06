import { useState } from 'react';
import type { z } from 'zod';
import type { Member } from '@erp/shared/api-responses';
import type { createMemberUserBody, updateMemberBody } from '@erp/shared/api-schemas';
import type { OperationKey } from '../../api/coverage';
import { useAction } from '../../api/queries/core';
import { ActionButton } from '../../components/ActionButton';
import { FormDialog } from '../../components/FormDialog';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { fmt, ru } from '../../i18n/ru';

// The dialogs of a membership (D-171), shared by P26 «Пользователи» (the organization's administrator, `/users*`) and
// P25 «Организация» (the system administrator, `/orgs/:id/users*`, `/orgs/:id/members`): the page passes the call and
// its operation key, and the own labels of the organization a label manager may get.

const t = ru.users;
type Role = Member['role'];
type Label = { id: string; name: string };
const ROLES = ['org_admin', 'label_manager'] as const;
const roleOptions = ROLES.map((r) => ({ id: r, label: t.roles[r] }));

/** The labels of a manager: one checkbox per own label (`field-user-labels`, `field-user-label-<id>`). */
function LabelChecks(props: { labels: readonly Label[]; value: readonly string[]; onChange: (ids: string[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-1" data-testid="field-user-labels">
      <legend className="mb-1 text-sm font-medium">{t.labels}</legend>
      <p className="text-xs text-muted">{t.labelsHint}</p>
      {props.labels.map((l) => (
        <label key={l.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            data-testid={`field-user-label-${l.id}`}
            checked={props.value.includes(l.id)}
            onChange={(e) => props.onChange(e.target.checked ? [...props.value, l.id] : props.value.filter((x) => x !== l.id))}
          />
          {l.name}
        </label>
      ))}
    </fieldset>
  );
}

/** The role and, for a label manager, the labels; nothing to pick when the organization has no own label. */
function RoleFields(props: {
  role: Role;
  setRole: (r: Role) => void;
  labelIds: string[];
  setLabelIds: (ids: string[]) => void;
  labels: readonly Label[] | undefined;
  /** Why the labels cannot be read (P25 without a support grant: the own labels are an organization read, D-171). */
  labelsUnavailable?: string;
}) {
  return (
    <>
      <SelectField name="user-role" label={t.role} value={props.role} onChange={(v) => props.setRole(v as Role)} options={roleOptions} isRequired />
      {props.role === 'label_manager' ? (
        props.labelsUnavailable ? (
          <p className="text-sm text-warning" data-testid="user-labels-unavailable">
            {props.labelsUnavailable}
          </p>
        ) : props.labels && props.labels.length === 0 ? (
          <p className="text-sm text-warning" data-testid="user-no-labels">
            {t.noLabels}
          </p>
        ) : (
          <LabelChecks labels={props.labels ?? []} value={props.labelIds} onChange={props.setLabelIds} />
        )
      ) : null}
    </>
  );
}

/** A manager needs at least one label, an administrator none (the API: 400 validation_error otherwise). */
const labelsOf = (role: Role, ids: string[]) => (role === 'label_manager' ? ids : []);

/**
 * A new user as a member (`action-create-user-submit`) or, with `existing`, an existing login added to the organization
 * (`action-add-member-submit`, no password).
 */
export function CreateMemberDialog(props: {
  op: OperationKey;
  labels: readonly Label[] | undefined;
  labelsUnavailable?: string;
  existing?: boolean;
  create: (body: z.input<typeof createMemberUserBody>) => Promise<Member>;
  onClose: () => void;
}) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('org_admin');
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const run = useAction(() => props.create({ login: login.trim(), password, role, labelIds: labelsOf(role, labelIds) }), {
    invalidate: 'reference',
    success: (u) => fmt(props.existing ? t.memberAdded : t.created, { login: u.login }),
  });
  const ready = login.trim() !== '' && (props.existing === true || password !== '') && (role === 'org_admin' || labelIds.length > 0);
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={props.existing ? t.addMember : t.create}
      subtitle={props.existing ? t.addMemberSubtitle : t.createSubtitle}
      footer={
        <ActionButton
          name={props.existing ? 'add-member-submit' : 'create-user-submit'}
          op={props.op}
          isPending={run.isPending}
          isDisabled={!ready}
          reason={role === 'label_manager' && labelIds.length === 0 ? t.pickLabel : ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {props.existing ? t.addMember : ru.common.create}
        </ActionButton>
      }
    >
      <TextField
        name={props.existing ? 'member-login' : 'user-login'}
        label={t.login}
        placeholder={t.loginHint}
        value={login}
        onChange={setLogin}
        autoComplete="off"
        isRequired
      />
      {props.existing ? null : (
        <TextField name="user-password" label={t.password} type="password" value={password} onChange={setPassword} autoComplete="new-password" isRequired />
      )}
      <RoleFields role={role} setRole={setRole} labelIds={labelIds} setLabelIds={setLabelIds} labels={props.labels} labelsUnavailable={props.labelsUnavailable} />
    </FormDialog>
  );
}

/** The role, the labels and the access of a member (`action-edit-user-submit`); only what changed is sent. */
export function EditMemberDialog(props: {
  op: OperationKey;
  member: Member;
  labels: readonly Label[] | undefined;
  labelsUnavailable?: string;
  update: (body: z.input<typeof updateMemberBody>) => Promise<Member>;
  onClose: () => void;
}) {
  const m = props.member;
  const [role, setRole] = useState<Role>(m.role);
  const [labelIds, setLabelIds] = useState<string[]>(m.labelIds);
  const [active, setActive] = useState(m.active ? 'yes' : 'no');
  const body = (): z.input<typeof updateMemberBody> => {
    const next = labelsOf(role, labelIds);
    const sameLabels = next.length === m.labelIds.length && next.every((id) => m.labelIds.includes(id));
    return {
      ...(role !== m.role ? { role } : {}),
      ...(!sameLabels ? { labelIds: next } : {}),
      ...((active === 'yes') !== m.active ? { active: active === 'yes' } : {}),
    };
  };
  const changed = Object.keys(body()).length > 0;
  const run = useAction(() => props.update(body()), { invalidate: 'reference', success: (u) => fmt(t.updated, { login: u.login }) });
  const ready = changed && (role === 'org_admin' || labelIds.length > 0);
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={fmt(t.editTitle, { login: m.login })}
      subtitle={t.editSubtitle}
      footer={
        <ActionButton
          name="edit-user-submit"
          op={props.op}
          isPending={run.isPending}
          isDisabled={!ready}
          reason={role === 'label_manager' && labelIds.length === 0 ? t.pickLabel : ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {ru.common.save}
        </ActionButton>
      }
    >
      <RoleFields role={role} setRole={setRole} labelIds={labelIds} setLabelIds={setLabelIds} labels={props.labels} labelsUnavailable={props.labelsUnavailable} />
      <SelectField
        name="user-active"
        label={t.active}
        value={active}
        onChange={setActive}
        options={[
          { id: 'yes', label: t.activeOptions.yes },
          { id: 'no', label: t.activeOptions.no },
        ]}
      />
    </FormDialog>
  );
}

/** A new password of a user (`action-reset-password-submit`); every session of the user ends. */
export function SetPasswordDialog(props: {
  op: OperationKey;
  login: string;
  set: (password: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const run = useAction(() => props.set(password), { invalidate: 'reference', success: () => fmt(t.passwordSet, { login: props.login }) });
  return (
    <FormDialog
      isOpen
      onOpenChange={(o) => (o ? null : props.onClose())}
      title={fmt(t.resetPasswordTitle, { login: props.login })}
      subtitle={t.resetPasswordSubtitle}
      footer={
        <ActionButton
          name="reset-password-submit"
          op={props.op}
          isPending={run.isPending}
          isDisabled={password === ''}
          reason={ru.actions.hints.fillFields}
          onPress={() => run.mutate(undefined, { onSuccess: props.onClose })}
        >
          {ru.common.save}
        </ActionButton>
      }
    >
      <TextField name="user-password" label={t.password} type="password" value={password} onChange={setPassword} autoComplete="new-password" isRequired />
    </FormDialog>
  );
}

/** The labels of a member by name (the own labels of the organization), «—» for none. */
export function labelNames(ids: readonly string[], labels: readonly Label[] | undefined): string {
  if (ids.length === 0) return '—';
  return ids.map((id) => labels?.find((l) => l.id === id)?.name ?? id).join(', ');
}
