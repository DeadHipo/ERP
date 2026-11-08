import { join } from 'node:path';
import type { OwnersService } from '../modules/owners';
import type { LabelsService } from '../modules/labels';
import type { SplitsService } from '../modules/splits';
import type { SourcesService } from '../modules/sources';
import type { SettlementsService } from '../modules/settlements';
import type { PublishingService } from '../modules/publishing';
import type { PubV2Service } from '../modules/pubv2';
import type { LinksService } from '../modules/links';
import type { AuditService } from '../modules/audit';
import type { AdsService } from '../modules/ads';
import { orgScope } from '../shared/org-scope';
import { publishingSourceOf } from '../shared/publishing-source';
import { openModules } from './modules';
import { createFacadeContext, type FacadeConfig } from './context';
import { splitsApi } from './splits';
import { sourcesApi } from './sources';
import { pubV2LinksApi } from './pubv2-links';
import { pubV2Source } from './pubv2-source';
import { reportsApi } from './reports';
import { ownerViewApi } from './owner-view';
import { artistViewApi } from './artist-view';
import { payoutsApi } from './payouts';
import { auditApi } from './audit';
import { aggregatesApi } from './aggregates';
import { searchApi } from './search';
import { adsApi } from './ads-api';
import { catalogApi } from './catalog';
import { splitImportApi } from './split-import';
import { releaseRegistryApi } from './release-registry';
import { onboardingApi } from './onboarding';
import { payrollApi } from './payroll';
import { operationImportApi } from './operation-import';
import { startApi } from './start';
import { admissionApi } from './admission';
import { cutsApi } from './cuts';

export type { FacadeConfig, ShareSpec } from './context';

/**
 * The facade: the only place that composes modules. It recalculates everything from scratch for every request.
 * Modules do not know about it. Every module is opened under one organization (`config.orgId`, D-170). All modules live in one PostgreSQL database (config.db, a schema per module); the
 * facade wraps writes that span modules in one transaction and reads that span them in one snapshot (D-121). The methods are grouped by topic in the sibling files; this file only opens the
 * modules and puts the groups together.
 */
export function openFacade(config: FacadeConfig) {
  const { db } = config;
  const org = orgScope(config.orgId);
  // the sources service must be of the same organization: its registry gives the loaded files every read starts from
  if (config.sources.orgId !== config.orgId)
    throw new Error('The sources service is opened under another organization than the facade');
  const opened = openModules(db, org, {
    // the original statements of the organization (D-170): two organizations may load the same file
    publishingDir: join(config.dataDir, 'orgs', config.orgId, 'files', 'publishing'),
  });
  const owners: OwnersService = opened.owners;
  const splits: SplitsService = opened.splits;
  const labels: LabelsService = opened.labels;
  const sources: SourcesService = config.sources;
  const settlements: SettlementsService = opened.settlements;
  const publishing: PublishingService = opened.publishing;
  const pubv2: PubV2Service = opened.pubv2;
  const links: LinksService = opened.links;
  const audit: AuditService = opened.audit;
  const ads: AdsService = opened.ads;
  // D-185: one switch of the source of the money; `calculate()` and the layers do not know it
  const source = config.publishingSource ?? publishingSourceOf();
  const ctx = createFacadeContext({ ...config, publishingSource: source }, {
    db,
    owners,
    splits,
    labels,
    sources,
    settlements,
    publishing: source === 'v2' ? pubV2Source(db, publishing, { pubv2, links, owners }) : publishing,
    audit,
    ads,
  });

  const splitsPart = splitsApi(ctx);
  const payoutsPart = payoutsApi(ctx);
  return {
    db,
    /** The organization every module of this facade is opened under (D-170). */
    orgId: config.orgId,
    modules: { owners, splits, labels, sources, settlements, publishing, pubv2, links, audit, ads },

    ...splitsPart,
    ...aggregatesApi(ctx, splitsPart),
    ...sourcesApi(ctx),
    ...reportsApi(ctx),
    ...ownerViewApi(ctx),
    ...artistViewApi(ctx, splitsPart),
    ...payoutsPart,
    ...auditApi(ctx),
    ...searchApi(ctx),
    ...adsApi(ctx),
    ...catalogApi(ctx),
    ...splitImportApi(ctx, splitsPart),
    ...releaseRegistryApi(ctx),
    ...onboardingApi(ctx),
    ...payrollApi(ctx),
    ...operationImportApi(ctx, payoutsPart),
    ...startApi(ctx),
    ...admissionApi(ctx),
    ...cutsApi(ctx),
    ...pubV2LinksApi(ctx, { pubv2, links, publishing }),
  };
}

export type Facade = ReturnType<typeof openFacade>;
export type { PeriodFilter } from './calculation';
