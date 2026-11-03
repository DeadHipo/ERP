import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';

export const labelKeys = { list: () => ['labels', 'list'] as const };

export const labelQueries = {
  list: () => queryOptions({ queryKey: labelKeys.list(), queryFn: () => api.labels.list() }),
};
