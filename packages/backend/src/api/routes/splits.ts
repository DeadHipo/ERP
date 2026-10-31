import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';

/** Splits (artists come from module 1, so through the facade). */
export function splitsRouter(facade: Facade) {
  const r = Router();

  r.get('/splits', (req, res) => {
    const q = parse(S.listQuery, req.query);
    res.json(
      facade.listSplits({
        ...(q.isrc ? { isrc: q.isrc } : {}),
        ...(q.artistId ? { artistId: q.artistId } : {}),
        limit: q.limit ?? 200,
      }),
    );
  });
  r.post('/splits', (req, res) =>
    res.status(201).json(facade.createSplit(parse(S.createSplitBody, req.body))),
  );
  r.post('/splits/change', (req, res) =>
    res.status(201).json(facade.changeSplit(parse(S.changeSplitBody, req.body))),
  );
  r.post('/splits/buyout', (req, res) => res.status(201).json(facade.buyout(parse(S.buyoutBody, req.body))));
  r.post('/splits/:id/confirm', (req, res) =>
    res.json(facade.confirmSplit(param(req, 'id'), parse(S.confirmSplitBody, req.body).documentId)),
  );

  return r;
}
