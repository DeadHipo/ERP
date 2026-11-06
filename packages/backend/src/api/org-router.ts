import { Router } from 'express';
import type { Facade } from '../facade';
import { operatorTrace } from './audit';
import { labelGuard } from './label-guard';
import { createV1Router } from './routes';

/**
 * The routes of one organization over its facade (D-170): the operator's trace, the label guard, then the v1 routes.
 * The routes never see the organization: the facade is opened under it.
 */
export function createOrgRouter(facade: Facade, opts: { tmpDir: string }): Router {
  const r = Router();
  r.use(operatorTrace(facade));
  r.use(labelGuard(facade));
  r.use(createV1Router(facade, opts));
  return r;
}
