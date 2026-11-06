import { join } from 'node:path';
import type { Db } from '../shared/pg-db';
import type { OrgScope } from '../shared/org-scope';
import { openOwnersModule } from '../modules/owners';
import { openLabelsModule } from '../modules/labels';
import { openSplitsModule } from '../modules/splits';
import { openSettlementsModule } from '../modules/settlements';
import { openPublishingModule } from '../modules/publishing';
import { openPubV2Module } from '../modules/pubv2';
import { openAuditModule } from '../modules/audit';
import { openAdsModule } from '../modules/ads';

/**
 * The 8 PostgreSQL modules opened under one organization (D-170): every statement of every repository is filtered by
 * `org` (`shared/org-scope.ts`), so a facade over them never sees a row of another organization. The sources module
 * is opened by the caller (`sourcesFor` in `connect-sources.ts`) under the same organization.
 */
export function openModules(db: Db, org: OrgScope, opts: { publishingDir: string }) {
  return {
    owners: openOwnersModule(db, org).service,
    splits: openSplitsModule(db, org).service,
    labels: openLabelsModule(db, org).service,
    settlements: openSettlementsModule(db, org).service,
    publishing: openPublishingModule(db, org, opts.publishingDir).service,
    pubv2: openPubV2Module(db, org, join(opts.publishingDir, 'v2')).service,
    audit: openAuditModule(db, org).service,
    ads: openAdsModule(db, org).service,
  };
}

export type OrgModules = ReturnType<typeof openModules>;
