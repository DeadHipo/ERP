import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { parse } from '../http';

/** The operator's trail (D-140): the writes that touched an entity, newest first; without `entityId` the latest writes. */
export function auditRouter(facade: Facade) {
  const r = Router();
  r.get('/audit', async (req, res) => {
    const q = parse(S.auditQuery, req.query);
    const items = q.entityId
      ? await facade.auditOf(q.entityId, q.limit ?? 50)
      : await facade.recentActions(q.limit ?? 50);
    res.json({ items });
  });
  return r;
}
