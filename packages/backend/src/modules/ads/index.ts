import type { Db } from '../../shared/pg-db';
import { createAdsService } from './service';

export * from './service';

/** Opens the ads module on the shared PostgreSQL database (schema `ads`, migrations/postgres/0012_ads.sql). */
export function openAdsModule(db: Db) {
  return { service: createAdsService(db) };
}
