import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { LoginLimiter } from '../auth/limits';
import { sessionCookieName, type AuthConfig } from '../auth/middleware';
import type { AuthService } from '../auth/service';
import type { Facade } from '../facade';
import type { OrgsService } from '../orgs/service';
import { buildOpenApiDocument } from './openapi';
import { authRouter } from './routes/auth';
import { orgsRouter } from './routes/orgs';
import { systemUsersRouter } from './routes/system-users';

export interface SystemDeps {
  auth: AuthService;
  config: AuthConfig;
  orgs: OrgsService;
  /** The facade of an organization (the counts of `/orgs`, the audit of a system write). */
  facadeOf: (orgId: string) => Promise<Facade>;
  /** The login limiter of this app instance (D-171). */
  limiter: LoginLimiter;
}

/**
 * The routes outside any organization (D-170), mounted on /api/v1 before the routes of the organization: `/health`,
 * `/openapi.json`, `/docs` (public), `/auth/*`, `/orgs*`, `/system/users*` (each with its own access check).
 */
export function createSystemRouter(deps: SystemDeps): Router {
  const r = Router();
  const openapi = buildOpenApiDocument({ sessionCookie: sessionCookieName(deps.config) });
  r.get('/openapi.json', (_req, res) => res.json(openapi));
  r.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
  r.get('/health', (_req, res) => res.json({ ok: true }));
  r.use(authRouter(deps));
  r.use(orgsRouter(deps));
  r.use(systemUsersRouter(deps));
  return r;
}
