import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@heroui/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/client';
import { ApiError } from '../../api/client';
import { SelectField } from '../../components/fields/SelectField';
import { TextField } from '../../components/fields/TextField';
import { ThemeToggle } from '../../components/ThemeToggle';
import { safeNext, setWorkOrg } from '../../lib/session';
import { errorText } from '../../i18n/ru/errors';
import { ru } from '../../i18n/ru';

const t = ru.auth;

type OrgChoice = { id: string; name: string; role: string };

/** The organizations of a `409 org_choice_required` (D-171: `details.orgs`, only after a right password). */
function orgChoicesOf(error: unknown): OrgChoice[] | null {
  if (!(error instanceof ApiError) || error.code !== 'org_choice_required') return null;
  const orgs = (error.details as { orgs?: unknown } | undefined)?.orgs;
  if (!Array.isArray(orgs)) return [];
  return orgs.flatMap((o: unknown) => {
    const x = o as Partial<OrgChoice> | null;
    return x && typeof x.id === 'string' && typeof x.name === 'string' ? [{ id: x.id, name: x.name, role: String(x.role ?? '') }] : [];
  });
}

/**
 * P23 «Вход» `/login?next=` (D-170), outside the shell: the login and the password, `POST /auth/login` sets the session
 * cookie; then `next` (a path of this app) or `/`. A refusal is the Russian sentence of its code (`invalid_credentials`,
 * `too_many_attempts`, `no_membership`). A user of several organizations gets `409 org_choice_required` with the list:
 * the second step on the same page (`field-login-org`, `action-login-org`) repeats the login with `orgId` (D-171); the
 * password stays in the form state until then.
 */
export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [choices, setChoices] = useState<OrgChoice[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const run = useMutation<unknown, Error, string | undefined>({
    mutationFn: (chosen) => api.auth.login({ login, password, ...(chosen ? { orgId: chosen } : {}) }),
    onError: (e) => {
      const orgs = orgChoicesOf(e);
      if (orgs) {
        setChoices(orgs);
        setOrgId((cur) => cur ?? orgs[0]?.id ?? null);
      }
    },
    onSuccess: () => {
      // another user may have used this tab: nothing of theirs stays (the cache, the chosen organization)
      setWorkOrg('');
      queryClient.clear();
      void navigate(safeNext(params.get('next')), { replace: true });
    },
  });
  const ready = login.trim() !== '' && password !== '' && !run.isPending;
  const choosing = choices !== null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    if (choosing) {
      if (orgId) run.mutate(orgId);
    } else run.mutate(undefined);
  };
  // the choice step is not an error to show
  const error = orgChoicesOf(run.error) ? null : run.error;
  const code = error instanceof ApiError ? error.code : undefined;
  return (
    <div className="flex h-full items-center justify-center bg-background text-foreground" data-testid="login-page">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <form onSubmit={submit} className="flex w-80 flex-col gap-4 rounded-xl border border-border p-6">
        <div>
          <h1 className="text-2xl font-semibold">{t.title}</h1>
          <p className="text-sm text-muted">{t.subtitle}</p>
        </div>
        <TextField
          name="login"
          label={t.login}
          value={login}
          onChange={(v) => {
            setLogin(v);
            setChoices(null);
          }}
          autoComplete="username"
          isRequired
          isDisabled={choosing}
        />
        <TextField
          name="password"
          label={t.password}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          isRequired
          isDisabled={choosing}
        />
        {choosing ? (
          <div className="flex flex-col gap-2" data-testid="login-org-step">
            <p className="text-sm text-muted">{t.chooseOrg}</p>
            <SelectField
              name="login-org"
              label={t.org}
              value={orgId}
              onChange={setOrgId}
              options={choices.map((o) => ({ id: o.id, label: `${o.name} · ${t.roles[o.role as keyof typeof t.roles] ?? o.role}` }))}
              isRequired
            />
          </div>
        ) : null}
        {error ? (
          <p className="text-sm text-danger" data-testid="login-error" data-code={code ?? 'error'}>
            {(code && errorText(code)) ?? error.message}
          </p>
        ) : null}
        {choosing ? (
          <div className="flex gap-2">
            <Button type="button" variant="secondary" data-testid="action-login-back" onPress={() => setChoices(null)}>
              {t.back}
            </Button>
            <Button type="submit" data-testid="action-login-org" isDisabled={!ready || !orgId} isPending={run.isPending}>
              {t.submit}
            </Button>
          </div>
        ) : (
          <Button type="submit" data-testid="action-login" isDisabled={!ready} isPending={run.isPending}>
            {t.submit}
          </Button>
        )}
      </form>
    </div>
  );
}
