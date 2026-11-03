import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Facade } from '../facade';
import { operatorTrace } from './audit';
import { errorHandler } from './http';
import { createV1Router } from './routes';

/**
 * Builds the Express app (JSON API under /api/v1, and the built React client when present).
 * Routes live in `routes/`, one file per topic; they only validate input and call the facade, or one module
 * service for single-module actions. Anything that needs two modules goes through the facade.
 */
export function createApp(facade: Facade, opts: { tmpDir: string; clientDist?: string }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', operatorTrace(facade));
  app.use('/api/v1', createV1Router(facade, opts));
  app.use('/api', (_req, res) =>
    res.status(404).json({ error: { code: 'not_found', message: 'Unknown API route', statusCode: 404 } }),
  );

  if (opts.clientDist && existsSync(opts.clientDist)) {
    const dist = opts.clientDist;
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
