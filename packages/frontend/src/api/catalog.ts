import type { z } from 'zod';
import type * as S from '@erp/shared/api-schemas';
import * as R from '@erp/shared/api-responses';
import { call } from './client';

// Client functions of the catalogue pages: the track summary and money, the breakdown of a month,
// releases, and the audit trail of an entity. One function per operation of packages/backend/src/api/operations.ts.

const id = encodeURIComponent;

export const catalog = {
  /** Every track with B, C, ours and net from one calculation, optionally one account and report month (N5). */
  trackSummary: (query: z.input<typeof S.trackSummaryQuery> = {}) =>
    call('GET', '/tracks/summary', { query, schema: R.trackSummarySchema }),
  /** Whose money of one ISRC by month: allocations with labels and the state after every layer (N6). */
  trackMoney: (isrc: string) => call('GET', `/tracks/${id(isrc)}/money`, { schema: R.trackMoneySchema }),
  /** Platform and country rows of one report month of an ISRC (N7, no calculation). */
  trackBreakdown: (isrc: string, month: string) =>
    call('GET', `/tracks/${id(isrc)}/breakdown/${id(month)}`, { schema: R.trackBreakdownSchema }),
  /** Releases (UPC) with track count and net of the loaded files (N8, no calculation). */
  releases: (query: z.input<typeof S.releasesQuery> = {}) =>
    call('GET', '/releases', { query, schema: R.releasesSchema }),
  /** One release: tracks and report months with B, C and ours (N9). */
  release: (upc: string) => call('GET', `/releases/${id(upc)}`, { schema: R.releaseSchema }),
  /** The audit trail of an entity (N16). */
  audit: (query: z.input<typeof S.auditQuery> = {}) => call('GET', '/audit', { query, schema: R.auditListSchema }),
};
