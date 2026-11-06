import type { Db } from '../../shared/pg-db';
import type { OrgScope } from '../../shared/org-scope';
import { createAdsService } from './service';

export * from './service';

/** Opens the ads module under one organization (D-170) on the shared PostgreSQL database (schema `ads`, migrations/postgres/0012_ads.sql). */
export function openAdsModule(db: Db, org: OrgScope) {
  return { service: createAdsService(db, org) };
}
