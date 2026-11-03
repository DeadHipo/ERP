import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';
import { MONEY_QUERY } from './core';

export const trackKeys = {
  list: () => ['tracks', 'list'] as const,
  explain: (isrc: string) => ['tracks', 'explain', isrc] as const,
};

export const trackQueries = {
  list: () => queryOptions({ queryKey: trackKeys.list(), queryFn: () => api.tracks.list() }),
  explain: (isrc: string) =>
    queryOptions({ queryKey: trackKeys.explain(isrc), queryFn: () => api.tracks.explain(isrc), ...MONEY_QUERY }),
};
