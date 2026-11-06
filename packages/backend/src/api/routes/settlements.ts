import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { viewerOf } from '../viewer';

/** Settlements: operations, payment proofs, returns, payout snapshots. */
export function settlementsRouter(facade: Facade) {
  const r = Router();

  r.get('/settlements/operations', async (req, res) => {
    const q = parse(S.operationsQuery, req.query);
    res.json(
      await facade.listOperations({
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.artistId ? { artistId: q.artistId } : {}),
        ...(q.meaning ? { meaning: q.meaning } : {}),
        ...(q.direction ? { direction: q.direction } : {}),
        ...(q.needsProof ? { needsProof: q.needsProof === 'true' } : {}),
        ...(q.active ? { active: q.active === 'true' } : {}),
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        ...(q.label ? { labelId: q.label } : {}),
      }),
    );
  });
  r.patch('/settlements/operations/:id', async (req, res) =>
    res.json(await facade.setOperationLabel(param(req, 'id'), parse(S.setOperationLabelBody, req.body).labelId, viewerOf(res))),
  );
  r.post('/settlements/operations', async (req, res) =>
    res.status(201).json(await facade.createOperation(parse(S.createOperationBody, req.body))),
  );
  r.post('/settlements/operations/:id/proof', async (req, res) =>
    res.json(await facade.attachPaymentProof(param(req, 'id'), parse(S.proofBody, req.body), viewerOf(res))),
  );
  r.post('/settlements/operations/:id/deferred', async (req, res) =>
    res.json(await facade.setOperationDeferred(param(req, 'id'), parse(S.deferredBody, req.body).deferred, viewerOf(res))),
  );
  r.post('/settlements/operations/:id/deactivate', async (req, res) => {
    const body = parse(S.deactivateBody, req.body);
    res.json(
      await facade.deactivateOperation(param(req, 'id'), body.reason, { transferFailed: body.transferFailed ?? false }, viewerOf(res)),
    );
  });
  r.post('/settlements/operations/:id/return', async (req, res) =>
    res.status(201).json(await facade.returnPayout(param(req, 'id'), parse(S.returnBody, req.body), viewerOf(res))),
  );
  r.get('/settlements/operations/:id/snapshot', async (req, res) =>
    res.json(await facade.operationSnapshot(param(req, 'id'), viewerOf(res))),
  );

  return r;
}
