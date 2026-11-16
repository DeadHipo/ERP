import { queryOptions } from '@tanstack/react-query';
import * as api from '../client';
import { MONEY_QUERY } from './core';

type QueryTermFilter = { sublabel?: string; isrc?: string; month?: string; noDocument?: boolean; withCancelled?: boolean };

/** The sublabels (D-217…D-219): the register and the terms are reference reads; the report and the hints are money. */
export const sublabelKeys = {
  list: () => ['sublabels', 'list'] as const,
  terms: (f: QueryTermFilter) =>
    ['sublabels', 'terms', f.sublabel ?? '', f.isrc ?? '', f.month ?? '', f.noDocument ? '1' : '0', f.withCancelled ? '1' : '0'] as const,
  report: (id: string, from: string, to: string) => ['sublabels', 'report', id, from, to] as const,
  suggestions: (month: string) => ['sublabels', 'suggestions', month] as const,
};

export const sublabelQueries = {
  list: () => queryOptions({ queryKey: sublabelKeys.list(), queryFn: () => api.sublabels.list() }),
  terms: (f: QueryTermFilter) =>
    queryOptions({
      queryKey: sublabelKeys.terms(f),
      queryFn: () =>
        api.sublabels.terms({
          ...(f.sublabel ? { sublabel: f.sublabel } : {}),
          ...(f.isrc ? { isrc: f.isrc } : {}),
          ...(f.month ? { month: f.month } : {}),
          ...(f.noDocument ? { noDocument: '1' as const } : {}),
          ...(f.withCancelled ? { withCancelled: '1' as const } : {}),
        }),
    }),
  report: (id: string, from: string, to: string) =>
    queryOptions({
      queryKey: sublabelKeys.report(id, from, to),
      queryFn: () => api.sublabels.report(id, { ...(from ? { from } : {}), ...(to ? { to } : {}) }),
      ...MONEY_QUERY,
    }),
  suggestions: (month: string) =>
    queryOptions({ queryKey: sublabelKeys.suggestions(month), queryFn: () => api.sublabels.suggestions(month), enabled: month !== '', ...MONEY_QUERY }),
};
