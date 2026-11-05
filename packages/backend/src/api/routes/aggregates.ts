import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';

/** Money aggregates for the screens (D-142): payables, tracks, releases, document uses. Mounted before the owner routes. */
export function aggregatesRouter(facade: Facade) {
  const r = Router();

  r.get('/owners/payables', async (req, res) =>
    res.json(await facade.ownerPayables(parse(S.payablesQuery, req.query))),
  );
  r.get('/tracks/summary', async (req, res) =>
    res.json(await facade.trackSummary(parse(S.trackSummaryQuery, req.query))),
  );
  r.get('/tracks/catalog', async (req, res) => res.json(await facade.trackCatalog(parse(S.trackCatalogQuery, req.query))));
  r.get('/tracks/:isrc/money', async (req, res) => res.json(await facade.trackMoney(param(req, 'isrc'))));
  r.get('/tracks/:isrc/breakdown/:month', async (req, res) =>
    res.json(await facade.trackBreakdown(param(req, 'isrc'), param(req, 'month'))),
  );
  r.get('/releases', async (req, res) => {
    const q = parse(S.releasesQuery, req.query);
    res.json(await facade.releases(q.q, q.label));
  });
  r.get('/releases/:upc', async (req, res) =>
    res.json(await facade.release(param(req, 'upc'), parse(S.releaseQuery, req.query).label)),
  );
  r.get('/documents/:id/uses', async (req, res) => res.json(await facade.documentUses(param(req, 'id'))));

  return r;
}
