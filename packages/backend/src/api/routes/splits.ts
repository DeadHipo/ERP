import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { viewerOf } from '../viewer';

/** Splits (artists come from module 1, so through the facade). */
export function splitsRouter(facade: Facade) {
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
  r.post('/splits/buyout', async (req, res) =>
    res.status(201).json(await facade.buyout(parse(S.buyoutBody, req.body), viewerOf(res))),
  );
  r.post('/splits/:id/confirm', async (req, res) =>
    res.json(await facade.confirmSplit(param(req, 'id'), parse(S.confirmSplitBody, req.body).documentId, viewerOf(res))),
  );

  return r;
}
