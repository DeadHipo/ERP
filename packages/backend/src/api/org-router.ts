import { Router } from 'express';
import type { Facade } from '../facade';
import { operatorTrace } from './audit';
import { authorize } from './authorize';
import { labelGuard } from './label-guard';
import { createV1Router } from './routes';

/**
 * The routes of one organization over its facade (D-170, D-171): the operator's trace, the label guard (a label of
 * another organization = 404), the right of the principal (`authorize`: the operation's ability, a label of the
 * organization that is not the user's = 403), then the v1 routes.
 * The routes never see the organization: the facade is opened under it.
 */
export function createOrgRouter(facade: Facade, opts: { tmpDir: string }): Router {
  const r = Router();
  r.use(operatorTrace(facade));
  r.use(labelGuard(facade));
  r.use(authorize());
  r.use(createV1Router(facade, opts));
  return r;
}
