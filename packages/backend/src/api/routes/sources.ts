import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { parse } from '../http';
import { receiveUpload } from '../upload';

/** Sources (Believe): the file registry of both sources, report lines and their facets, Believe upload. */
export function sourcesRouter(facade: Facade, opts: { tmpDir: string }) {
  const { sources, publishing } = facade.modules;
  const r = Router();

  r.get('/sources/files', async (_req, res) =>
    res.json({
      believe: (await sources.listFiles()).map(({ storedPath: _p, ...f }) => f),
      b17: await publishing.listStatements(),
    }),
  );
  r.get('/sources/lines', async (req, res) => {
    const { fileId, ...rest } = parse(S.sourceLinesQuery, req.query);
    const ids = fileId?.split(',').filter(Boolean);
    res.json(await sources.lines({ ...rest, ...(ids?.length ? { fileIds: ids } : {}) }));
  });
  r.get('/sources/lines/facets', async (req, res) => {
    const ids = parse(S.sourceFacetsQuery, req.query).fileId?.split(',').filter(Boolean);
    res.json(await sources.linesFacets(ids));
  });
  r.post('/sources/believe', async (req, res) => {
    const up = await receiveUpload(req, opts.tmpDir);
    try {
      res.status(201).json(await facade.ingestBelieve({ path: up.path, fileName: up.fileName }));
    } finally {
      await up.cleanup();
    }
  });

  return r;
}
