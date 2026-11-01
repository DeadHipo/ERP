import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';

/** Settlements: operations, payment proofs, returns, payout snapshots. */
export function settlementsRouter(facade: Facade) {
  const { settlements } = facade.modules;
  const r = Router();

  r.get('/settlements/operations', async (req, res) => {
    const ownerId = parse(S.listQuery, req.query).ownerId;
    res.json(await settlements.listOperations(ownerId ? { ownerId } : {}));
  });
  r.post('/settlements/operations', async (req, res) =>
    res.status(201).json(await facade.createOperation(parse(S.createOperationBody, req.body))),
  );
  r.post('/settlements/operations/:id/proof', async (req, res) =>
    res.json(await facade.attachPaymentProof(param(req, 'id'), parse(S.proofBody, req.body))),
  );
  r.post('/settlements/operations/:id/deferred', async (req, res) =>
    res.json(await settlements.setDeferred(param(req, 'id'), parse(S.deferredBody, req.body).deferred)),
  );
  r.post('/settlements/operations/:id/deactivate', async (req, res) => {
    const body = parse(S.deactivateBody, req.body);
    res.json(
      await settlements.deactivate(param(req, 'id'), body.reason, {
        transferFailed: body.transferFailed ?? false,
      }),
    );
  });
  r.post('/settlements/operations/:id/return', async (req, res) =>
    res.status(201).json(await facade.returnPayout(param(req, 'id'), parse(S.returnBody, req.body))),
  );
  r.get('/settlements/operations/:id/snapshot', async (req, res) =>
    res.json(await settlements.getSnapshot(param(req, 'id'))),
  );

  return r;
}
