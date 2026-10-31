import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import { ConflictError } from '../../shared/errors';
import type { Facade } from '../../facade';
import { param, parse } from '../http';

/** Module 1: owners, artists, tracks, documents, contracts. */
export function ownersRouter(facade: Facade) {
  const { owners } = facade.modules;
  const r = Router();

  r.get('/owners', (_req, res) => res.json(owners.listOwners()));
  r.post('/owners', (req, res) => {
    const b = parse(S.createOwnerBody, req.body);
    const similar = owners.findSimilarOwners(b.name);
    if (similar.length > 0 && !b.force) {
      throw new ConflictError(
        'Records with the same name exist: choose "the same" or create a new one',
        'possible_duplicate',
        {
          similar,
        },
      );
    }
    res
      .status(201)
      .json(owners.createOwner({ name: b.name, kind: b.kind, ipi: b.ipi ?? null, aliases: b.aliases ?? [] }));
  });
  r.post('/owners/merge', (req, res) => {
    const b = parse(S.mergeOwnersBody, req.body);
    res.json(facade.mergeOwners(b.fromId, b.intoId, b.reason));
  });
  r.get('/owners/:id', (req, res) => res.json(facade.ownerDetail(param(req, 'id'))));
  r.get('/owners/:id/balance', async (req, res) =>
    res.json(await facade.ownerBalance(param(req, 'id'), parse(S.periodQuery, req.query))),
  );
  r.post('/owners/:id/payouts', async (req, res) => {
    const b = parse(S.createPayoutBody, req.body ?? {});
    res.status(201).json(await facade.createPayout(param(req, 'id'), b));
  });

  r.get('/artists', (_req, res) => {
    const idx = owners.artistIndex();
    res.json([...idx.entries()].filter(([id, a]) => id === a.id).map(([, a]) => a));
  });
  r.post('/artists', (req, res) => {
    const b = parse(S.createArtistBody, req.body);
    const similar = owners.findSimilarArtists(b.pseudonym);
    if (similar.length > 0 && !b.force) {
      throw new ConflictError(
        'Artists with this pseudonym exist: choose "the same" or create a new one',
        'possible_duplicate',
        {
          similar,
        },
      );
    }
    res.status(201).json(owners.createArtist({ pseudonym: b.pseudonym, ownerId: b.ownerId ?? null }));
  });
  r.get('/artists/:id', (req, res) => res.json(owners.getArtist(param(req, 'id'))));
  r.post('/artists/:id/owner', (req, res) => {
    owners.assignArtistOwner(param(req, 'id'), parse(S.assignOwnerBody, req.body).ownerId);
    res.json(owners.getArtist(param(req, 'id')));
  });

  r.get('/tracks', (_req, res) => res.json(owners.listTracks()));
  r.post('/tracks', (req, res) =>
    res.status(201).json(owners.createTrack(parse(S.createTrackBody, req.body))),
  );
  r.patch('/tracks/:id', (req, res) => {
    const b = parse(S.updateTrackBody, req.body);
    res.json(owners.setTrackIdentifiers(param(req, 'id'), b.isrc, b.upc));
  });
  r.get('/tracks/:isrc/explain', async (req, res) => res.json(await facade.explainTrack(param(req, 'isrc'))));

  r.get('/documents', (req, res) => res.json(owners.listDocuments(parse(S.listQuery, req.query).ownerId)));
  r.post('/documents', (req, res) =>
    res.status(201).json(owners.createDocument(parse(S.createDocumentBody, req.body))),
  );
  r.post('/documents/:id/attach', (req, res) =>
    res.json(owners.attachFile(param(req, 'id'), parse(S.attachFileBody, req.body).fileRef)),
  );
  r.post('/documents/:id/approve', (req, res) =>
    res.json(owners.approveDocument(param(req, 'id'), parse(S.approveBody, req.body ?? {}).by)),
  );
  r.post('/contracts', (req, res) =>
    res.status(201).json(owners.createContract(parse(S.createContractBody, req.body))),
  );

  return r;
}
