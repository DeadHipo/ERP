import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { receiveUpload, uploadLabel } from '../upload';

/** Publishing v2 (D-182): the report summaries as a list of files, songwriters and songs; no owner, no money rule. */
export function publishingV2Router(facade: Facade, opts: { tmpDir: string }) {
  const { pubv2 } = facade.modules;
  const r = Router();

  r.get('/publishing-v2/files', async (req, res) => res.json(await pubv2.listFiles(parse(S.labelQuery, req.query).label)));
  r.post('/publishing-v2/files', async (req, res) => {
    const labelId = await uploadLabel(facade, req); // before the body is received (D-169)
    const { replace } = parse(S.pubV2UploadQuery, req.query);
    const up = await receiveUpload(req, opts.tmpDir);
    try {
      res.status(201).json(await pubv2.ingest({ path: up.path, fileName: up.fileName, labelId, replace: replace === '1' }));
    } finally {
      await up.cleanup();
    }
  });
  r.post('/publishing-v2/files/:id/remove', async (req, res) => res.json(await pubv2.removeFile(param(req, 'id'))));
  r.get('/publishing-v2/songwriters', async (req, res) =>
    res.json(await pubv2.listSongwriters(parse(S.labelQuery, req.query).label)),
  );
  r.get('/publishing-v2/songwriters/:id', async (req, res) =>
    res.json(await pubv2.songwriter(param(req, 'id'), parse(S.labelQuery, req.query).label)),
  );
  r.get('/publishing-v2/links', async (req, res) => res.json(await facade.pubV2Links(parse(S.labelQuery, req.query).label)));
  r.post('/publishing-v2/links', async (req, res) =>
    res.json(await facade.linkSongwriter(parse(S.pubV2LinkBody, req.body), res.locals.operator as string)),
  );
  r.get('/publishing-v2/songs', async (req, res) => res.json(await facade.pubV2Songs(parse(S.labelQuery, req.query).label)));
  r.get('/publishing-v2/songs/:id/candidates', async (req, res) => {
    parse(S.labelQuery, req.query);
    res.json(await facade.pubV2SongCandidates(param(req, 'id')));
  });
  r.post('/publishing-v2/songs/:id/isrcs', async (req, res) =>
    res.json(await facade.setPubV2SongIsrcs(param(req, 'id'), parse(S.pubV2SongIsrcsBody, req.body).isrcs, res.locals.operator as string)),
  );
  r.post('/publishing-v2/terms', async (req, res) =>
    res.status(201).json(await facade.setPublishingTerm(parse(S.pubV2TermBody, req.body), res.locals.operator as string)),
  );
  r.post('/publishing-v2/terms/:id/cancel', async (req, res) =>
    res.json(await facade.cancelPublishingTerm(param(req, 'id'), res.locals.operator as string, parse(S.pubV2TermCancelBody, req.body).reason)),
  );
  return r;
}
