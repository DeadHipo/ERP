import { join } from 'node:path';
import { openOwnersModule, type OwnersService } from '../modules/owners';
import { openLabelsModule, type LabelsService } from '../modules/labels';
import { openSplitsModule, type SplitsService } from '../modules/splits';
import type { SourcesService } from '../modules/sources';
import { openSettlementsModule, type SettlementsService } from '../modules/settlements';
import { openPublishingModule, type PublishingService } from '../modules/publishing';
import { openAuditModule, type AuditService } from '../modules/audit';
import { createFacadeContext, type FacadeConfig } from './context';
import { splitsApi } from './splits';
import { sourcesApi } from './sources';
import { reportsApi } from './reports';
import { ownerViewApi } from './owner-view';
import { payoutsApi } from './payouts';
import { auditApi } from './audit';

export type { FacadeConfig, ShareSpec } from './context';

/**
 * The facade: the only place that composes modules. It recalculates everything from scratch for every request.
 * Modules do not know about it. All modules live in one PostgreSQL database (config.db, a schema per module); the
 * facade wraps writes that span modules in one transaction and reads that span them in one snapshot (D-121). The methods are grouped by topic in the sibling files; this file only opens the
 * modules and puts the groups together.
 */
export function openFacade(config: FacadeConfig) {
  const { db } = config;
  const owners: OwnersService = openOwnersModule(db).service;
  const splits: SplitsService = openSplitsModule(db).service;
  const labels: LabelsService = openLabelsModule(db).service;
  const sources: SourcesService = config.sources;
  const settlements: SettlementsService = openSettlementsModule(db).service;
  const publishing: PublishingService = openPublishingModule(
    db,
    join(config.dataDir, 'files', 'publishing'),
  ).service;
  const audit: AuditService = openAuditModule(db).service;
  const ctx = createFacadeContext(config, {
    db,
    owners,
    splits,
    labels,
    sources,
    settlements,
    publishing,
    audit,
  });

  return {
    db,
    modules: { owners, splits, labels, sources, settlements, publishing, audit },

    ...splitsApi(ctx),
    ...sourcesApi(ctx),
    ...reportsApi(ctx),
    ...ownerViewApi(ctx),
    ...payoutsApi(ctx),
    ...auditApi(ctx),
  };
}

export type Facade = ReturnType<typeof openFacade>;
export type { PeriodFilter } from './calculation';
