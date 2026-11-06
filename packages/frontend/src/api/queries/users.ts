import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

export const userKeys = {
  list: () => ['users', 'list'] as const,
  support: () => ['users', 'support'] as const,
  system: () => ['users', 'system'] as const,
};

/** The users (D-171): the members and support grants of the organization (P26), every user for the system (P27). No money. */
export const userQueries = {
  list: () => queryOptions({ queryKey: userKeys.list(), queryFn: () => api.users.list() }),
  support: () => queryOptions({ queryKey: userKeys.support(), queryFn: () => api.support.list() }),
  system: () => queryOptions({ queryKey: userKeys.system(), queryFn: () => api.systemUsers.list() }),
};
