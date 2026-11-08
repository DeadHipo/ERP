import { Router } from 'express';
import * as S from '@erp/shared/api-schemas';
import { ConflictError } from '../../shared/errors';
import type { Facade } from '../../facade';
import { param, parse } from '../http';
import { pagedField, pagedList } from '../paging';
import { viewerOf } from '../viewer';
import { timed, timedSync } from '../../shared/timing';

/** Module 1: owners, artists, tracks, documents, contracts. */
export function ownersRouter(facade: Facade) {
  const { owners } = facade.modules;
  const r = Router();

  r.get('/search', async (req, res) => {
    const q = parse(S.searchQuery, req.query);
    res.json(await facade.search(q.q, q.kinds, viewerOf(res)));
  });
  r.get('/owners', async (req, res) => {
    const { limit, offset, ...q } = parse(S.ownersQuery, req.query);
    res.json(pagedList(res, await facade.ownerList(q), { limit, offset }));
  });
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
  r.get('/owners/:id', async (req, res) => res.json(await facade.ownerDetail(param(req, 'id'), viewerOf(res))));
  // the cuts of the owner (D-200): per label, per cut its positions, attributed operations and movement
  r.get('/owners/:id/cuts', async (req, res) => res.json(await facade.ownerCuts(param(req, 'id'), parse(S.cutListQuery, req.query).label, viewerOf(res))));
  r.get('/owners/:id/balance', async (req, res) =>
    timed(`GET /owners/${param(req, 'id')}/balance`, async () => {
      const { label, ...period } = parse(S.balanceQuery, req.query);
      const b = await facade.ownerBalance(param(req, 'id'), period, label, viewerOf(res));
      timedSync('res.json (serialize + send)', () => res.json(b));
    }),
  );
  r.post('/owners/:id/payouts', async (req, res) => {
    const b = parse(S.createPayoutBody, req.body ?? {});
    res.status(201).json(await facade.createPayout(param(req, 'id'), b));
  });

  r.get('/artists', async (req, res) =>
    timed('GET /artists', async () => {
      const { limit, offset, ...q } = parse(S.artistsQuery, req.query);
      res.json(pagedList(res, await facade.artistList(q), { limit, offset }));
    }),
  );
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
  r.get('/artists/duplicates', async (_req, res) => res.json(await facade.artistDuplicates(viewerOf(res))));
  r.get('/artists/balances', async (req, res) =>
    timed('GET /artists/balances', async () => {
      const { limit, offset, ...q } = parse(S.artistBalancesQuery, req.query);
      const b = pagedField(res, await facade.artistBalances(q), 'items', { limit, offset });
      timedSync('res.json (serialize + send)', () => res.json(b));
    }),
  );
  r.get('/artists/:id', async (req, res) => res.json(await facade.artistDetail(param(req, 'id'), viewerOf(res))));
  r.get('/artists/:id/balance', async (req, res) =>
    timed(`GET /artists/${param(req, 'id')}/balance`, async () => {
      const { label, ...period } = parse(S.labelPeriodQuery, req.query);
      const b = await facade.artistBalance(param(req, 'id'), period, label, viewerOf(res));
      timedSync('res.json (serialize + send)', () => res.json(b));
    }),
  );
  r.post('/artists/:id/owner', async (req, res) => {
    await owners.assignArtistOwner(param(req, 'id'), parse(S.assignOwnerBody, req.body).ownerId);
    res.json(await owners.getArtist(param(req, 'id')));
  });

  r.get('/tracks', async (req, res) => res.json(pagedList(res, await owners.listTracks(), parse(S.pageQuery, req.query))));
  r.post('/tracks', async (req, res) =>
    res.status(201).json(await owners.createTrack(parse(S.createTrackBody, req.body))),
  );
  r.patch('/tracks/:id', async (req, res) =>
    res.json(await facade.updateTrack(param(req, 'id'), parse(S.updateTrackBody, req.body), viewerOf(res))),
  );
  r.get('/tracks/:isrc/explain', async (req, res) => res.json(await facade.explainTrack(param(req, 'isrc'))));

  r.get('/documents', async (req, res) => {
    const { limit, offset, ...q } = parse(S.documentsQuery, req.query);
    res.json(pagedList(res, await facade.listDocuments(q), { limit, offset }));
  });
  r.post('/documents', async (req, res) =>
    res.status(201).json(await facade.createDocument(parse(S.createDocumentBody, req.body))),
  );
  r.patch('/documents/:id', async (req, res) =>
    res.json(await facade.setDocumentLabel(param(req, 'id'), parse(S.setDocumentLabelBody, req.body).labelId, viewerOf(res))),
  );
  r.post('/documents/:id/attach', async (req, res) =>
    res.json(await facade.attachDocumentFile(param(req, 'id'), parse(S.attachFileBody, req.body).fileRef, viewerOf(res))),
  );
  r.post('/documents/:id/approve', async (req, res) =>
    res.json(
      await facade.approveDocument(
        param(req, 'id'),
        (res.locals.operator as string | undefined) ?? parse(S.approveBody, req.body ?? {}).by,
        viewerOf(res),
      ),
    ),
  );
  r.post('/contracts', async (req, res) =>
    res.status(201).json(await facade.createContract(parse(S.createContractBody, req.body), viewerOf(res))),
  );
  // the payout threshold of a contract (D-176)
  r.patch('/contracts/:id', async (req, res) =>
    res.json(await facade.setContractThreshold(param(req, 'id'), parse(S.contractThresholdBody, req.body).payoutThresholdCents)),
  );

  return r;
}
