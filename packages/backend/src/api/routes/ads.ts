import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { defaultLimit } from '../paging';
import { viewerOf } from '../viewer';

/** Advertising expenses (D-155, D-156). */
export function adsRouter(facade: Facade) {
  const r = Router();

  r.get('/ads', async (req, res) => {
    const q = parse(S.adsQuery, req.query);
    const limit = q.limit ?? defaultLimit(res);
    res.json(
      await facade.listAds({
        ...(q.isrc ? { isrc: q.isrc } : {}),
        ...(q.artistId ? { artistId: q.artistId } : {}),
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.includeInactive === 'true' ? { includeInactive: true } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(q.offset !== undefined ? { offset: q.offset } : {}),
        ...(q.label ? { labelId: q.label } : {}),
      }),
    );
  });
  r.post('/ads', async (req, res) =>
    res.status(201).json(await facade.createAds(parse(S.createAdsBody, req.body).items)),
  );
  r.get('/ads/summary', async (req, res) => {
    const { label, ...f } = parse(S.adsSummaryQuery, req.query);
    res.json(await facade.adsSummary({ ...f, ...(label ? { labelId: label } : {}) }));
  });
  r.get('/ads/:id', async (req, res) => res.json(await facade.getAd(param(req, 'id'), viewerOf(res))));
  r.patch('/ads/:id', async (req, res) => res.json(await facade.updateAd(param(req, 'id'), parse(S.updateAdBody, req.body), viewerOf(res))));
  r.post('/ads/:id/deactivate', async (req, res) =>
    res.json(await facade.deactivateAd(param(req, 'id'), parse(S.deactivateAdBody, req.body).reason, viewerOf(res))),
  );

  return r;
}
