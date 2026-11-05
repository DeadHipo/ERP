import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { parse } from '../http';
import { receiveUpload, uploadLabel } from '../upload';

/** Sources (Believe): the file registry of both sources, report lines and their facets, Believe upload. */
export function sourcesRouter(facade: Facade, opts: { tmpDir: string }) {
  const r = Router();

  r.get('/sources/files', async (req, res) =>
    res.json(await facade.sourceFiles(parse(S.sourceFilesQuery, req.query).label)),
  );
  r.get('/sources/lines', async (req, res) => {
    const { fileId, label, ...rest } = parse(S.sourceLinesQuery, req.query);
    const ids = fileId?.split(',').filter(Boolean);
    res.json(
      await facade.sourceLines({
        ...rest,
        ...(ids?.length ? { fileIds: ids } : {}),
        ...(label !== undefined ? { labelId: label } : {}),
      }),
    );
  });
  r.get('/sources/lines/facets', async (req, res) => {
    const { fileId, label } = parse(S.sourceFacetsQuery, req.query);
    const ids = fileId?.split(',').filter(Boolean);
    res.json(
      await facade.sourceFacets({
        ...(ids?.length ? { fileIds: ids } : {}),
        ...(label !== undefined ? { labelId: label } : {}),
      }),
    );
  });
  r.post('/sources/believe', async (req, res) => {
    const labelId = await uploadLabel(facade, req);
    const up = await receiveUpload(req, opts.tmpDir);
    try {
      const file = await facade.ingestBelieve(
        { path: up.path, fileName: up.fileName, uploadedBy: res.locals.operator as string },
        labelId,
      );
      res.status(201).json({ ...file, storedPath: undefined }); // the server path is not part of the response
    } finally {
      await up.cleanup();
    }
  });

  return r;
}
