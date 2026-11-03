import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

export const publishingKeys = { writers: () => ['publishing', 'writers'] as const };

export const publishingQueries = {
  writers: () => queryOptions({ queryKey: publishingKeys.writers(), queryFn: () => api.publishing.writers() }),
};
