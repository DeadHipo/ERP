import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { viewerOf } from '../viewer';
import { OPERATION_IMPORT_MAX_BYTES } from '@erp/shared/operation-import';
import { START_IMPORT_MAX_BYTES } from '@erp/shared/start-import';
import { AppError } from '../../shared/errors';
import { drain, receiveUpload } from '../upload';

/** Settlements: operations, payment proofs, returns, payout snapshots. */
export function settlementsRouter(facade: Facade, opts: { tmpDir: string }) {
  const r = Router();

  r.get('/settlements/operations', async (req, res) => {
    const q = parse(S.operationsQuery, req.query);
    res.json(
      await facade.listOperations({
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.artistId ? { artistId: q.artistId } : {}),
        // `meaning` is the alias of `kind` (D-173): `recoupable_payout` = `advance`
        ...(q.kind ? { kind: q.kind } : q.meaning ? { kind: q.meaning === 'recoupable_payout' ? 'advance' : q.meaning } : {}),
        ...(q.labelSource ? { labelSource: q.labelSource === 'none' ? null : q.labelSource } : {}),
        ...(q.direction ? { direction: q.direction } : {}),
        ...(q.needsProof ? { needsProof: q.needsProof === 'true' } : {}),
        ...(q.active ? { active: q.active === 'true' } : {}),
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
        ...(q.label ? { labelId: q.label } : {}),
      }),
    );
  });
  r.patch('/settlements/operations/:id', async (req, res) => {
    const body = parse(S.setOperationLabelBody, req.body);
    res.json(await facade.setOperationLabel(param(req, 'id'), body.labelId, body.reason, viewerOf(res)));
  });
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
  r.post('/settlements/operations/:id/forgive', async (req, res) =>
    res.status(201).json(await facade.forgiveAdvance(param(req, 'id'), parse(S.forgiveBody, req.body), viewerOf(res))),
  );
  r.get('/settlements/operations/:id/snapshot', async (req, res) =>
    res.json(await facade.operationSnapshot(param(req, 'id'), viewerOf(res))),
  );

  // the operation import (D-173 §1.5): the label is checked before the body is received; dryRun=1 (default) is the preview
  r.post('/settlements/operations/import', async (req, res) => {
    let q: ReturnType<typeof S.operationImportQuery.parse>;
    try {
      q = parse(S.operationImportQuery, req.query);
      await facade.assertUploadLabel(q.label);
    } catch (e) {
      await drain(req);
      throw e;
    }
    const up = await receiveUpload(req, opts.tmpDir, {
      maxBytes: OPERATION_IMPORT_MAX_BYTES,
      error: () => new AppError('The import file is larger than 10 MB', 413, 'import_too_large', { maxBytes: OPERATION_IMPORT_MAX_BYTES }),
    });
    try {
      const dryRun = q.dryRun === '1';
      const out = await facade.importOperations({ path: up.path, fileName: up.fileName, labelId: q.label, dryRun, documentId: q.documentId });
      res.status(dryRun ? 200 : 201).json(out);
    } finally {
      await up.cleanup();
    }
  });

  // the opening balances (D-174): the list of a book, the import with a preview, the soft rollback of a row
  r.get('/settlements/start', async (req, res) => {
    const q = parse(S.startListQuery, req.query);
    res.json(await facade.listStart({ labelId: q.label, active: q.active === undefined ? undefined : q.active === 'true' }, viewerOf(res)));
  });
  r.post('/settlements/start/import', async (req, res) => {
    let q: ReturnType<typeof S.startImportQuery.parse>;
    try {
      q = parse(S.startImportQuery, req.query);
      await facade.assertUploadLabel(q.label);
    } catch (e) {
      await drain(req);
      throw e;
    }
    const up = await receiveUpload(req, opts.tmpDir, {
      maxBytes: START_IMPORT_MAX_BYTES,
      error: () => new AppError('The import file is larger than 10 MB', 413, 'import_too_large', { maxBytes: START_IMPORT_MAX_BYTES }),
    });
    try {
      const dryRun = q.dryRun === '1';
      const out = await facade.importStart({ path: up.path, fileName: up.fileName, labelId: q.label, cutoff: q.cutoff, syncedAt: q.syncedAt, dryRun, basis: q.basis });
      res.status(dryRun ? 200 : 201).json(out);
    } finally {
      await up.cleanup();
    }
  });
  r.post('/settlements/start/:id/deactivate', async (req, res) =>
    res.json(await facade.deactivateStart(param(req, 'id'), parse(S.deactivateStartBody, req.body).reason)),
  );

  return r;
}
