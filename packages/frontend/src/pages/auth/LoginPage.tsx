import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@heroui/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/client';
import { ApiError } from '../../api/client';
import { TextField } from '../../components/fields/TextField';
import { ThemeToggle } from '../../components/ThemeToggle';
import { safeNext, setWorkOrg } from '../../lib/session';
import { errorText } from '../../i18n/ru/errors';
import { ru } from '../../i18n/ru';

const t = ru.auth;

/**
 * P23 «Вход» `/login?next=` (D-170), outside the shell: the login and the password, `POST /auth/login` sets the session
 * cookie; then `next` (a path of this app) or `/`. A refusal is the Russian sentence of its code (`invalid_credentials`).
 */
export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const run = useMutation<unknown, Error>({
    mutationFn: () => api.auth.login({ login, password }),
    onSuccess: () => {
      // another user may have used this tab: nothing of theirs stays (the cache, the chosen organization)
      setWorkOrg('');
      queryClient.clear();
      void navigate(safeNext(params.get('next')), { replace: true });
    },
  });
  const ready = login.trim() !== '' && password !== '' && !run.isPending;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) run.mutate();
  };
  const error = run.error;
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
        <TextField name="login" label={t.login} value={login} onChange={setLogin} autoComplete="username" isRequired />
        <TextField
          name="password"
          label={t.password}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          isRequired
        />
        {error ? (
          <p className="text-sm text-danger" data-testid="login-error" data-code={code ?? 'error'}>
            {(code && errorText(code)) ?? error.message}
          </p>
        ) : null}
        <Button type="submit" data-testid="action-login" isDisabled={!ready} isPending={run.isPending}>
          {t.submit}
        </Button>
      </form>
    </div>
  );
}
