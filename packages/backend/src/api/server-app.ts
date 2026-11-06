import express from 'express';
import { authenticateOrSystemKey, type AuthConfig } from '../auth/middleware';
import type { AuthService } from '../auth/service';
import type { OrgFacades } from '../orgs/facades';
import { orgRoutes, resolveOrg } from '../orgs/middleware';
import { serveClient, unknownApiRoute } from './app';
import { errorHandler } from './http';
import { requestId } from './request-id';
import { createSystemRouter } from './system-router';

/**
 * The application of the server (D-170): every organization of the database behind the login. The chain:
 * requestId → express.json → authenticateOrSystemKey (/api) → the system routes (`/health`, `/openapi.json`, `/docs`,
 * `/auth/*`, `/orgs*` with requireUser / requireSystem and the system trace) → resolveOrg (the organization of the
 * session, `X-Org` of the system administrator, ERP_DEFAULT_ORG in `off`) → the router of the organization
 * (operatorTrace → labelGuard → the v1 routes).
 */
export function createServerApp(deps: {
  orgs: OrgFacades;
  auth: { service: AuthService; config: AuthConfig };
  clientDist?: string;
}) {
  const { orgs, auth } = deps;
  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', authenticateOrSystemKey(auth.service, auth.config));
  app.use(
    '/api/v1',
    createSystemRouter({
      auth: auth.service,
      config: auth.config,
      orgs: orgs.service,
      facadeOf: async (id) => (await orgs.get(id)).facade,
    }),
  );
  app.use('/api/v1', resolveOrg(orgs, auth.config), orgRoutes);
  app.use('/api', unknownApiRoute);
  serveClient(app, deps.clientDist);
  app.use(errorHandler);
  return app;
}
