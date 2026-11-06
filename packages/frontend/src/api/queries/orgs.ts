import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

export const orgKeys = {
  list: () => ['orgs', 'list'] as const,
  detail: (id: string) => ['orgs', 'detail', id] as const,
  users: (id: string) => ['orgs', 'users', id] as const,
  labels: (id: string) => ['orgs', 'labels', id] as const,
};

/** The organizations of the system administrator (P24, P25): counts only, never money. */
export const orgQueries = {
  list: () => queryOptions({ queryKey: orgKeys.list(), queryFn: () => api.orgs.list() }),
  detail: (id: string) => queryOptions({ queryKey: orgKeys.detail(id), queryFn: () => api.orgs.get(id) }),
  users: (id: string) => queryOptions({ queryKey: orgKeys.users(id), queryFn: () => api.orgs.users(id) }),
  /** The own labels of the organization (`X-Org` of that organization): the labels a label manager may get (D-171). */
  labels: (id: string) =>
    queryOptions({
      queryKey: orgKeys.labels(id),
      queryFn: async () => (await api.labels.listOf(id)).filter((l) => l.kind === 'own'),
    }),
};
