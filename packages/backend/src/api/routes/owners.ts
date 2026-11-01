import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import { ConflictError } from '../../shared/errors';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { timed, timedSync } from '../../shared/timing';

/** Module 1: owners, artists, tracks, documents, contracts. */
export function ownersRouter(facade: Facade) {
  const { owners } = facade.modules;
  const r = Router();

  r.get('/owners', async (_req, res) => res.json(await owners.listOwners()));
  r.post('/owners', async (req, res) => {
    const b = parse(S.createOwnerBody, req.body);
    const similar = await owners.findSimilarOwners(b.name);
    if (similar.length > 0 && !b.force) {
      throw new ConflictError(
        'Records with the same name exist: choose "the same" or create a new one',
        'possible_duplicate',
        {
          similar,
        },
      );
    }
    res.status(201).json(
      await owners.createOwner({
        name: b.name,
        kind: b.kind,
        ipi: b.ipi ?? null,
        aliases: b.aliases ?? [],
      }),
    );
  });
  r.post('/owners/merge', async (req, res) => {
    const b = parse(S.mergeOwnersBody, req.body);
    res.json(await facade.mergeOwners(b.fromId, b.intoId, b.reason));
  });
  r.get('/owners/:id', async (req, res) => res.json(await facade.ownerDetail(param(req, 'id'))));
  r.get('/owners/:id/balance', async (req, res) =>
    timed(`GET /owners/${param(req, 'id')}/balance`, async () => {
      const b = await facade.ownerBalance(param(req, 'id'), parse(S.periodQuery, req.query));
      timedSync('res.json (serialize + send)', () => res.json(b));
    }),
  );
  r.post('/owners/:id/payouts', async (req, res) => {
    const b = parse(S.createPayoutBody, req.body ?? {});
    res.status(201).json(await facade.createPayout(param(req, 'id'), b));
  });

  r.get('/artists', async (_req, res) => {
    const idx = await owners.artistIndex();
    res.json([...idx.entries()].filter(([id, a]) => id === a.id).map(([, a]) => a));
  });
  r.post('/artists', async (req, res) => {
    const b = parse(S.createArtistBody, req.body);
    const similar = await owners.findSimilarArtists(b.pseudonym);
    if (similar.length > 0 && !b.force) {
      throw new ConflictError(
        'Artists with this pseudonym exist: choose "the same" or create a new one',
        'possible_duplicate',
        {
          similar,
        },
      );
    }
    res.status(201).json(await owners.createArtist({ pseudonym: b.pseudonym, ownerId: b.ownerId ?? null }));
  });
  r.get('/artists/:id', async (req, res) => res.json(await owners.getArtist(param(req, 'id'))));
  r.post('/artists/:id/owner', async (req, res) => {
    await owners.assignArtistOwner(param(req, 'id'), parse(S.assignOwnerBody, req.body).ownerId);
    res.json(await owners.getArtist(param(req, 'id')));
  });

  r.get('/tracks', async (_req, res) => res.json(await owners.listTracks()));
  r.post('/tracks', async (req, res) =>
    res.status(201).json(await owners.createTrack(parse(S.createTrackBody, req.body))),
  );
  r.patch('/tracks/:id', async (req, res) => {
    const b = parse(S.updateTrackBody, req.body);
    res.json(await owners.setTrackIdentifiers(param(req, 'id'), b.isrc, b.upc));
  });
  r.get('/tracks/:isrc/explain', async (req, res) => res.json(await facade.explainTrack(param(req, 'isrc'))));

  r.get('/documents', async (req, res) =>
    res.json(await owners.listDocuments(parse(S.listQuery, req.query).ownerId)),
  );
  r.post('/documents', async (req, res) =>
    res.status(201).json(await owners.createDocument(parse(S.createDocumentBody, req.body))),
  );
  r.post('/documents/:id/attach', async (req, res) =>
    res.json(await owners.attachFile(param(req, 'id'), parse(S.attachFileBody, req.body).fileRef)),
  );
  r.post('/documents/:id/approve', async (req, res) =>
    res.json(await owners.approveDocument(param(req, 'id'), parse(S.approveBody, req.body ?? {}).by)),
  );
  r.post('/contracts', async (req, res) =>
    res.status(201).json(await owners.createContract(parse(S.createContractBody, req.body))),
  );

  return r;
}
