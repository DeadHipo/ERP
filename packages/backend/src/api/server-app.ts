import express from 'express';
import { createLoginLimiter } from '../auth/limits';
import { authenticateOrSystemKey, noStore, originGuard, type AuthConfig } from '../auth/middleware';
import type { AuthService } from '../auth/service';
import type { OrgFacades } from '../orgs/facades';
import { orgRoutes, resolveOrg } from '../orgs/middleware';
import { serveClient, unknownApiRoute } from './app';
import { errorHandler } from './http';
import { requestId } from './request-id';
import { createSystemRouter } from './system-router';

/**
 * The application of the server (D-170, D-171): every organization of the database behind the login. The chain:
 * requestId → `Cache-Control: no-store` and the `Origin` check of writes (/api) → express.json →
 * authenticateOrSystemKey (/api) → the system routes (`/health`, `/openapi.json`, `/docs`,
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
  if (auth.config.trustProxy !== undefined) app.set('trust proxy', auth.config.trustProxy);
  // the login limiter belongs to this app instance (failed attempts only; 0 or unset = off)
  const limiter = createLoginLimiter({ perLogin: auth.config.loginLimit ?? 0, perIp: auth.config.ipLimit ?? 0 });
  app.use(requestId);
  app.use('/api', noStore, originGuard(auth.config));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', authenticateOrSystemKey(auth.service, auth.config));
  app.use(
    '/api/v1',
    createSystemRouter({
      auth: auth.service,
      config: auth.config,
      orgs: orgs.service,
      facadeOf: async (id) => (await orgs.get(id)).facade,
      limiter,
    }),
  );
  app.use('/api/v1', resolveOrg(orgs, auth.config), orgRoutes);
  app.use('/api', unknownApiRoute);
  serveClient(app, deps.clientDist);
  app.use(errorHandler);
  return app;
}
