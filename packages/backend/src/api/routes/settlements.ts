import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';

/** Settlements: operations, payment proofs, returns, payout snapshots. */
export function settlementsRouter(facade: Facade) {
  const { settlements } = facade.modules;
  const r = Router();

  r.get('/settlements/operations', (req, res) => {
    const ownerId = parse(S.listQuery, req.query).ownerId;
    res.json(settlements.listOperations(ownerId ? { ownerId } : {}));
  });
  r.post('/settlements/operations', (req, res) =>
    res.status(201).json(facade.createOperation(parse(S.createOperationBody, req.body))),
  );
  r.post('/settlements/operations/:id/proof', (req, res) =>
    res.json(facade.attachPaymentProof(param(req, 'id'), parse(S.proofBody, req.body))),
  );
  r.post('/settlements/operations/:id/deferred', (req, res) =>
    res.json(settlements.setDeferred(param(req, 'id'), parse(S.deferredBody, req.body).deferred)),
  );
  r.post('/settlements/operations/:id/deactivate', (req, res) => {
    const body = parse(S.deactivateBody, req.body);
    res.json(
      settlements.deactivate(param(req, 'id'), body.reason, { transferFailed: body.transferFailed ?? false }),
    );
  });
  r.post('/settlements/operations/:id/return', (req, res) =>
    res.status(201).json(facade.returnPayout(param(req, 'id'), parse(S.returnBody, req.body))),
  );
  r.get('/settlements/operations/:id/snapshot', (req, res) =>
    res.json(settlements.getSnapshot(param(req, 'id'))),
  );

  return r;
}
