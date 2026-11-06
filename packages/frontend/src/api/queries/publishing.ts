import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';
import { MONEY_QUERY } from './core';

export const publishingKeys = { writers: () => ['publishing', 'writers'] as const };

export const publishingQueries = {
  writers: () => queryOptions({ queryKey: publishingKeys.writers(), queryFn: () => api.publishing.writers() }),
};

/** Publishing v2 (D-182): sums of the reports, money keys (`MONEY_KEYS`), never fresh. */
export const publishingV2Keys = {
  files: (label: string) => ['publishingV2', 'files', label] as const,
  links: (label: string) => ['publishingV2', 'links', label] as const,
  songwriters: (label: string) => ['publishingV2', 'songwriters', label] as const,
  songwriter: (id: string, label: string) => ['publishingV2', 'songwriter', id, label] as const,
};

const labelFilter = (label: string) => (label ? { label } : {});

export const publishingV2Queries = {
  files: (label: string) =>
    queryOptions({ queryKey: publishingV2Keys.files(label), queryFn: () => api.publishingV2.files(labelFilter(label)), ...MONEY_QUERY }),
  links: (label: string) =>
    queryOptions({ queryKey: publishingV2Keys.links(label), queryFn: () => api.publishingV2.links(labelFilter(label)), ...MONEY_QUERY }),
  songwriters: (label: string) =>
    queryOptions({
      queryKey: publishingV2Keys.songwriters(label),
      queryFn: () => api.publishingV2.songwriters(labelFilter(label)),
      ...MONEY_QUERY,
    }),
  songwriter: (id: string, label: string) =>
    queryOptions({
      queryKey: publishingV2Keys.songwriter(id, label),
      queryFn: () => api.publishingV2.songwriter(id, labelFilter(label)),
      ...MONEY_QUERY,
    }),
};
