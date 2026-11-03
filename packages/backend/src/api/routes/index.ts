import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { Facade } from '../../facade';
import { buildOpenApiDocument } from '../openapi';
import { ownersRouter } from './owners';
import { splitsRouter } from './splits';
import { sourcesRouter } from './sources';
import { publishingRouter } from './publishing';
import { reportsRouter } from './reports';
import { settlementsRouter } from './settlements';
import { labelsRouter } from './labels';
import { participationsRouter } from './participations';
import { auditRouter } from './audit';

/** Version 1 of the JSON API: one router per topic, all mounted at the root of the version. */
export function createV1Router(facade: Facade, opts: { tmpDir: string }) {
  const r = Router();
  const openapi = buildOpenApiDocument();
  r.get('/openapi.json', (_req, res) => res.json(openapi));
  r.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
  r.get('/health', (_req, res) => res.json({ ok: true }));
  r.use(ownersRouter(facade));
  r.use(splitsRouter(facade));
  r.use(sourcesRouter(facade, opts));
  r.use(publishingRouter(facade, opts));
  r.use(reportsRouter(facade));
  r.use(settlementsRouter(facade));
  r.use(labelsRouter(facade));
  r.use(participationsRouter(facade));
  r.use(auditRouter(facade));
  return r;
}
