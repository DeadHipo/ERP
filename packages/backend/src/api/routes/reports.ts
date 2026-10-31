import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { parse } from '../http';

/** Facade views over everything: reconciliation and signals. */
export function reportsRouter(facade: Facade) {
  const r = Router();

  r.get('/reconciliation', async (req, res) =>
    res.json(await facade.reconciliation(parse(S.periodQuery, req.query))),
  );
  r.get('/signals', async (req, res) => {
    const s = await facade.signals(parse(S.periodQuery, req.query));
    const limit = parse(S.listQuery, req.query).limit ?? 100;
    res.json({
      ...s,
      unallocated: {
        ...s.unallocated,
        count: s.unallocated.pairs.length,
        pairs: s.unallocated.pairs.slice(0, limit),
      },
      isrcsWithoutSplit: { count: s.isrcsWithoutSplit.length, items: s.isrcsWithoutSplit.slice(0, limit) },
    });
  });

  return r;
}
