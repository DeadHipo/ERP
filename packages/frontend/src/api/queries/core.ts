import { useRef } from 'react';
import { QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../client';
import { notifyError, notifySuccess } from '../../components/toast';

/**
 * Query keys are `[domain, name, ...params]`. A key is a MONEY key when its first two elements are in this list:
 * the answer comes from one recalculation (D-012, R2). The recalc indicator watches these, and every mutation
 * invalidates them.
 */
export const MONEY_KEYS: readonly (readonly [string, string])[] = [
  ['owners', 'balance'],
  ['publishingV2', 'files'],
  ['publishingV2', 'songwriters'],
  ['publishingV2', 'songwriter'],
  ['owners', 'payables'],
  ['artists', 'balance'],
  ['artists', 'balances'],
  ['reports', 'reconciliation'],
  ['reports', 'signals'],
  ['reports', 'overview'],
  ['reports', 'queue'],
  ['tracks', 'explain'],
  ['tracks', 'summary'],
  ['tracks', 'money'],
  ['releases', 'list'],
  ['releases', 'detail'],
  ['documents', 'uses'],
  ['ads', 'list'],
  ['ads', 'summary'],
];

export function isMoneyKey(queryKey: readonly unknown[]): boolean {
  return MONEY_KEYS.some(([domain, name]) => queryKey[0] === domain && queryKey[1] === name);
}

/** Money queries are never fresh (staleTime 0); reference lists may be reused for a short time. */
export const MONEY_QUERY = { staleTime: 0 } as const;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: 0, staleTime: 30_000, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  });
}

export function invalidateMoney(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (q) => isMoneyKey(q.queryKey) });
}

export function invalidateReference(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ predicate: (q) => !isMoneyKey(q.queryKey) });
}

export function useAction<Args, Result>(
  mutationFn: (args: Args) => Promise<Result>,
  options: {
    /** Which cached queries an accepted write makes stale. */
    invalidate: 'money' | 'reference' | 'all';
    /** The success toast text, built from the response (what changed). */
    success?: (result: Result, args: Args) => string;
    /** An error the page answers itself (e.g. a dialog that fixes it and repeats, D-169): true = no error toast. */
    handled?: (error: ApiError, args: Args) => boolean;
  },
) {
  const queryClient = useQueryClient();
  // A synchronous guard: two clicks in the same tick (a double click) must send one request, before React re-renders
  // the button as disabled (17 §8, repeated action).
  const inFlight = useRef(false);
  const mutation = useMutation<Result, ApiError, Args>({
    mutationFn,
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (result, args) => {
      if (options.invalidate === 'money') void invalidateMoney(queryClient);
      else if (options.invalidate === 'reference') void invalidateReference(queryClient);
      else void queryClient.invalidateQueries();
      notifySuccess(options.success ? options.success(result, args) : undefined);
    },
    onError: (error, args) => {
      if (!options.handled?.(error, args)) notifyError(error);
    },
  });
  const mutate: typeof mutation.mutate = (...rest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(...rest);
  };
  return { ...mutation, mutate };
}
