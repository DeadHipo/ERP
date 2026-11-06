import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { SPLIT_IMPORT_MAX_BYTES } from '@erp/shared/split-import';
import { AppError } from '../../shared/errors';
import { param, parse } from '../http';
import { drain, receiveUpload } from '../upload';
import { viewerOf } from '../viewer';

/** Splits (artists come from module 1, so through the facade). */
export function splitsRouter(facade: Facade, opts: { tmpDir: string }) {
  const r = Router();

  r.get('/splits', async (req, res) => {
    const q = parse(S.listQuery, req.query);
    res.json(
      await facade.listSplits({
        ...(q.isrc ? { isrc: q.isrc } : {}),
        ...(q.artistId ? { artistId: q.artistId } : {}),
        limit: q.limit ?? 200,
        ...(q.offset !== undefined ? { offset: q.offset } : {}),
        ...(q.status ? { status: q.status } : {}),
      }, viewerOf(res)),
    );
  });
  r.post('/splits', async (req, res) =>
    res.status(201).json(await facade.createSplit(parse(S.createSplitBody, req.body), viewerOf(res))),
  );
  r.post('/splits/change', async (req, res) =>
    res.status(201).json(await facade.changeSplit(parse(S.changeSplitBody, req.body), viewerOf(res))),
  );
  // the split import (D-172): the label is checked before the body is received; dryRun=1 (default) is the preview
  r.post('/splits/import', async (req, res) => {
    let q: ReturnType<typeof S.splitImportQuery.parse>;
    try {
      q = parse(S.splitImportQuery, req.query);
      await facade.assertUploadLabel(q.label);
    } catch (e) {
      await drain(req);
      throw e;
    }
    const up = await receiveUpload(req, opts.tmpDir, {
      maxBytes: SPLIT_IMPORT_MAX_BYTES,
      error: () => new AppError('The import file is larger than 10 MB', 413, 'import_too_large', { maxBytes: SPLIT_IMPORT_MAX_BYTES }),
    });
    try {
      const dryRun = q.dryRun === '1';
      const out = await facade.importSplits({ path: up.path, fileName: up.fileName, labelId: q.label, dryRun }, viewerOf(res));
      res.status(dryRun ? 200 : 201).json(out);
    } finally {
      await up.cleanup();
    }
  });
  // «accept as an assumption» (D-172): one assumption document under the label for the splits without a document
  r.post('/splits/assume', async (req, res) =>
    res.status(201).json(await facade.assumeSplits(parse(S.assumeSplitsBody, req.body), viewerOf(res))),
  );
  r.post('/splits/buyout', async (req, res) =>
    res.status(201).json(await facade.buyout(parse(S.buyoutBody, req.body), viewerOf(res))),
  );
  r.post('/splits/:id/confirm', async (req, res) =>
    res.json(await facade.confirmSplit(param(req, 'id'), parse(S.confirmSplitBody, req.body).documentId, viewerOf(res))),
  );

  return r;
}
