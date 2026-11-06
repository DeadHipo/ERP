import express, { type Express, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { authenticateOrSystemKey, type AuthConfig } from '../auth/middleware';
import { createAuthService } from '../auth/service';
import type { Facade } from '../facade';
import type { OrgFacades } from '../orgs/facades';
import { createOrgsService, OrgNotFoundError } from '../orgs/service';
import { errorHandler } from './http';
import { createOrgRouter } from './org-router';
import { requestId } from './request-id';
import { createSystemRouter } from './system-router';

/** `404 not_found` for a path under /api that no route serves. */
export function unknownApiRoute(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route', statusCode: 404 } });
}

/** Serves the built React client when present (every path outside /api gets index.html). */
export function serveClient(app: Express, clientDist: string | undefined): void {
  if (clientDist && existsSync(clientDist)) {
    app.use(express.static(clientDist));
    // `root` so that only the relative path is checked for dot segments: an absolute path under a dot directory
    // (a git worktree in `.claude/worktrees/`) is otherwise refused by `send` as a dotfile (D-160).
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile('index.html', { root: clientDist }));
  }
}

/**
 * The app of ONE organization in `AUTH_MODE=off` (tests, D-170): the facade's organization is every request's, the
 * operator comes from `X-Operator`. The same system router as the server (`/health`, `/openapi.json`, `/docs`,
 * `/auth/*`, `/orgs*`, the last with `X-System-Key` = `auth.systemKey`), then the organization's routes
 * (operatorTrace → labelGuard → v1). `orgs` opens the other organizations of `/orgs*` (counts, the audit of a
 * system write); without it only the facade's own organization is known. The server uses `createServerApp`.
 * Routes live in `routes/`, one file per topic; they only validate input and call the facade, or one module service
 * for single-module actions. Anything that needs two modules goes through the facade.
 */
export function createApp(
  facade: Facade,
  opts: {
    tmpDir: string;
    clientDist?: string;
    auth?: Pick<AuthConfig, 'systemKey' | 'secret'>;
    orgs?: OrgFacades;
  },
) {
  const config: AuthConfig = { mode: 'off', defaultOrg: facade.orgId, ...opts.auth };
  const auth = createAuthService(facade.db);
  const facadeOf = async (id: string): Promise<Facade> => {
    if (id === facade.orgId) return facade;
    if (opts.orgs) return (await opts.orgs.get(id)).facade;
    throw new OrgNotFoundError(id);
  };

  const app = express();
  app.use(requestId);
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', authenticateOrSystemKey(auth, config));
  app.use(
    '/api/v1',
    createSystemRouter({ auth, config, orgs: opts.orgs?.service ?? createOrgsService(facade.db), facadeOf }),
  );
  app.use('/api/v1', createOrgRouter(facade, { tmpDir: opts.tmpDir }));
  app.use('/api', unknownApiRoute);
  serveClient(app, opts.clientDist);
  app.use(errorHandler);
  return app;
}
