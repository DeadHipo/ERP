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

  r.get('/search', async (req, res) => {
    const q = parse(S.searchQuery, req.query);
    res.json(await facade.search(q.q, q.kinds));
  });
  r.get('/owners', async (req, res) => res.json(await facade.ownerList(parse(S.ownersQuery, req.query))));
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
      const { label, ...period } = parse(S.labelPeriodQuery, req.query);
      const b = await facade.ownerBalance(param(req, 'id'), period, label);
      timedSync('res.json (serialize + send)', () => res.json(b));
    }),
  );
  r.post('/owners/:id/payouts', async (req, res) => {
    const b = parse(S.createPayoutBody, req.body ?? {});
    res.status(201).json(await facade.createPayout(param(req, 'id'), b));
  });

  r.get('/artists', async (req, res) => timed('GET /artists', async () => res.json(await facade.artistList(parse(S.artistsQuery, req.query)))));
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
  r.get('/artists/duplicates', async (_req, res) => res.json(await facade.artistDuplicates()));
  r.get('/artists/balances', async (req, res) =>
    timed('GET /artists/balances', async () => {
      const b = await facade.artistBalances(parse(S.artistBalancesQuery, req.query));
      timedSync('res.json (serialize + send)', () => res.json(b));
    }),
  );
  r.get('/artists/:id', async (req, res) => res.json(await facade.artistDetail(param(req, 'id'))));
  r.get('/artists/:id/balance', async (req, res) =>
    timed(`GET /artists/${param(req, 'id')}/balance`, async () => {
      const { label, ...period } = parse(S.labelPeriodQuery, req.query);
      const b = await facade.artistBalance(param(req, 'id'), period, label);
      timedSync('res.json (serialize + send)', () => res.json(b));
    }),
  );
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
    const id = param(req, 'id');
    let track;
    if (b.isrc !== undefined && b.upc !== undefined)
      track = await owners.setTrackIdentifiers(id, b.isrc, b.upc);
    if (b.note !== undefined) track = await owners.setTrackNote(id, b.note);
    res.json(track);
  });
  r.get('/tracks/:isrc/explain', async (req, res) => res.json(await facade.explainTrack(param(req, 'isrc'))));

  r.get('/documents', async (req, res) =>
    res.json(await facade.listDocuments(parse(S.documentsQuery, req.query))),
  );
  r.post('/documents', async (req, res) =>
    res.status(201).json(await facade.createDocument(parse(S.createDocumentBody, req.body))),
  );
  r.patch('/documents/:id', async (req, res) =>
    res.json(await facade.setDocumentLabel(param(req, 'id'), parse(S.setDocumentLabelBody, req.body).labelId)),
  );
  r.post('/documents/:id/attach', async (req, res) =>
    res.json(await owners.attachFile(param(req, 'id'), parse(S.attachFileBody, req.body).fileRef)),
  );
  r.post('/documents/:id/approve', async (req, res) =>
    res.json(
      await owners.approveDocument(
        param(req, 'id'),
        (res.locals.operator as string | undefined) ?? parse(S.approveBody, req.body ?? {}).by,
      ),
    ),
  );
  r.post('/contracts', async (req, res) =>
    res.status(201).json(await owners.createContract(parse(S.createContractBody, req.body))),
  );

  return r;
}
