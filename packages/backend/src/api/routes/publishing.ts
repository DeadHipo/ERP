import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { receiveUpload, uploadLabel } from '../upload';
import { viewerOf } from '../viewer';

/** Publishing (B17): statement upload, writers, contract terms. */
export function publishingRouter(facade: Facade, opts: { tmpDir: string }) {
  const { publishing } = facade.modules;
  const r = Router();

  r.post('/publishing/b17', async (req, res) => {
    const labelId = await uploadLabel(facade, req); // before the body is received (D-169)
    const up = await receiveUpload(req, opts.tmpDir);
    try {
      res.status(201).json(
        await facade.ingestB17(
          {
            path: up.path,
            fileName: up.fileName,
            generatedAt: up.fields['generatedAt'] || null,
          },
          labelId,
        ),
      );
    } finally {
      await up.cleanup();
    }
  });
  // the replacement of a loaded statement (D-173): approve, the label before the body as for the upload
  r.post('/publishing/statements/:id/replace', async (req, res) => {
    const labelId = await uploadLabel(facade, req);
    const up = await receiveUpload(req, opts.tmpDir);
    try {
      res.status(201).json(
        await facade.replaceB17(
          param(req, 'id'),
          { path: up.path, fileName: up.fileName, generatedAt: up.fields['generatedAt'] || null },
          labelId,
          viewerOf(res),
        ),
      );
    } finally {
      await up.cleanup();
    }
  });
  r.get('/publishing/writers', async (_req, res) => res.json(await publishing.listWriters()));
  r.post('/publishing/writers/:norm/map', async (req, res) =>
    res.json(await facade.mapWriter(param(req, 'norm'), parse(S.mapWriterBody, req.body))),
  );
  r.post('/publishing/writers/resolve', async (_req, res) => res.json(await facade.resolveWriters()));
  r.post('/publishing/terms', async (req, res) =>
    res.status(201).json(await facade.setPublishingTerms(parse(S.publishingTermsBody, req.body))),
  );

  return r;
}
