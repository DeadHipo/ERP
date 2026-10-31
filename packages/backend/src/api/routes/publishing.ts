import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { receiveUpload } from '../upload';

/** Publishing (B17): statement upload, writers, contract terms. */
export function publishingRouter(facade: Facade, opts: { tmpDir: string }) {
  const { publishing } = facade.modules;
  const r = Router();

  r.post('/publishing/b17', async (req, res) => {
    const up = await receiveUpload(req, opts.tmpDir);
    try {
      res.status(201).json(
        await facade.ingestB17({
          path: up.path,
          fileName: up.fileName,
          generatedAt: up.fields['generatedAt'] || null,
        }),
      );
    } finally {
      await up.cleanup();
    }
  });
  r.get('/publishing/writers', (_req, res) => res.json(publishing.listWriters()));
  r.post('/publishing/writers/:norm/map', (req, res) =>
    res.json(facade.mapWriter(param(req, 'norm'), parse(S.mapWriterBody, req.body))),
  );
  r.post('/publishing/writers/resolve', (_req, res) => res.json(facade.resolveWriters()));
  r.post('/publishing/terms', (req, res) =>
    res.status(201).json(facade.setPublishingTerms(parse(S.publishingTermsBody, req.body))),
  );

  return r;
}
