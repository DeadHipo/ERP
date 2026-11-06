import { Router } from 'express';
import type { Facade } from '../../facade';
import { aggregatesRouter } from './aggregates';
import { ownersRouter } from './owners';
import { splitsRouter } from './splits';
import { sourcesRouter } from './sources';
import { publishingRouter } from './publishing';
import { reportsRouter } from './reports';
import { settlementsRouter } from './settlements';
import { labelsRouter } from './labels';
import { participationsRouter } from './participations';
import { auditRouter } from './audit';
import { adsRouter } from './ads';

/**
 * Version 1 of the JSON API of one organization: one router per topic, all mounted at the root of the version. The
 * system routes (`/health`, `/openapi.json`, `/docs`, `/auth/*`, `/orgs*`) are `createSystemRouter` (D-170).
 */
export function createV1Router(facade: Facade, opts: { tmpDir: string }) {
  const r = Router();
  r.use(aggregatesRouter(facade)); // before ownersRouter: /owners/payables is not /owners/:id
  r.use(ownersRouter(facade));
  r.use(splitsRouter(facade));
  r.use(sourcesRouter(facade, opts));
  r.use(publishingRouter(facade, opts));
  r.use(reportsRouter(facade));
  r.use(settlementsRouter(facade));
  r.use(labelsRouter(facade));
  r.use(participationsRouter(facade));
  r.use(auditRouter(facade));
  r.use(adsRouter(facade));
  return r;
}
