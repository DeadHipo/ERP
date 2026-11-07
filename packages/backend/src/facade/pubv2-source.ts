import type { Db } from '../shared/pg-db';
import type { LinksService } from '../modules/links';
import type { PublishingService } from '../modules/publishing';
import type { PubV2Service } from '../modules/pubv2';

type Snapshot = Awaited<ReturnType<PublishingService['snapshotForCalculation']>>;

/**
 * The publishing of the calculation read from the report summaries and the links (D-185), in the shape of the old
 * module: `calculate()` and the layers stay as they are, the service is only answered differently, as in `scope.ts`.
 * The money goes to the owner of the songwriter: a line has no `songwriters`, so D-087 has nothing to divide, and no
 * `operationType`, and the terms of v2 carry none (D-188). A songwriter without a link waits as `writer_unmapped`.
 */
export function pubV2Source(db: Db, publishing: PublishingService, m: { pubv2: PubV2Service; links: LinksService }): PublishingService {
  const snapshotForCalculation = (o: { lines?: boolean } = {}): Promise<Snapshot> =>
    db.snapshot(async () => {
      const decided = new Map((await m.links.songwriterOwners()).map((l) => [l.songwriterId, l.ownerId]));
      const writers = (await m.pubv2.listSongwriters()).map((w) => ({
        writerNorm: w.id,
        displayName: w.name,
        ownerId: decided.get(w.id) ?? null,
        resolution: decided.has(w.id) ? 'manual' : 'unmapped',
        role: 'holder',
      }));
      const terms = (await m.links.publishingTerms()).map(({ decidedBy: _b, cancelledAt: _c, cancelledBy: _cb, cancelReason: _r, ...t }) => ({
        ...t,
        operationType: null,
      }));
      const lines =
        o.lines === false
          ? []
          : (await m.pubv2.linesForCalculation()).map((l) => ({
              period: l.period,
              writerNorm: l.songwriterId,
              writerName: l.songwriter,
              workTitle: l.title,
              songwriters: null,
              operationType: null,
              labelId: l.labelId,
              payablePico: l.payablePico,
            }));
      return { writers, terms, lines };
    });
  return Object.assign(Object.create(publishing) as PublishingService, { snapshotForCalculation });
}
