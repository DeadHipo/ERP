import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { viewerOf } from '../viewer';

/** Participations: off-the-top, artist pool, artist share and label share carves (D-126). */
export function participationsRouter(facade: Facade) {
  const r = Router();

  r.get('/participations', async (req, res) => {
    const q = parse(S.listQuery, req.query);
    res.json(
      await facade.listParticipations({
        ...(q.isrc ? { isrc: q.isrc } : {}),
        ...(q.artistId ? { artistId: q.artistId } : {}),
        ...(q.limit !== undefined ? { limit: q.limit } : {}),
        ...(q.offset !== undefined ? { offset: q.offset } : {}),
      }, viewerOf(res)),
    );
  });
  r.post('/participations', async (req, res) =>
    res.status(201).json(await facade.createParticipation(parse(S.createParticipationBody, req.body), viewerOf(res))),
  );
  r.post('/participations/:id/close', async (req, res) =>
    res.json(await facade.closeParticipation(param(req, 'id'), parse(S.closeValidToBody, req.body).validTo, viewerOf(res))),
  );

  return r;
}
