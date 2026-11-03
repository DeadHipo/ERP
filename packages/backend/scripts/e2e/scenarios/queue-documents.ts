import type { Scenario } from './index';

// S12 (G19), S13 (G10a/b), S32 (rule_unconfirmed): the waiting queue, document actions.

export const queueDocuments: Scenario[] = [
  {
    id: 'S12',
    async run(_f, { seed }) {
      const c = seed.sc(12, 1); // row A 50 with no document; P 10 (bucket, label_share) approved
      await c.person('A', 'P');
      await c.track(1);
      await c.split(1, [['A', '50']], { doc: null });
      await c.part(1, 'P', '10', 'bucket', 'label_share');
      await c.load('2026-03', [{ j: 1, net: '100' }]);
    },
  },
  {
    id: 'S13',
    async run(f, { seed }) {
      const c = seed.sc(13, 1);
      await c.person('A', 'L', 'D');
      await c.track(1);
      const q1 = await c.assumption('Q1', 'Q1: less other participants');
      await c.split(1, [['A', '23'], ['L', '20', q1], ['D', '7']]);
      const buyout = await c.doc('buyout', 'buyout');
      await f.buyout({ isrcs: [c.isrc(1)], sellerArtistId: c.id('A'), effectiveFrom: '2026-05-01', documentId: buyout });
      await c.load('2026-03', [{ j: 1, net: '100' }]);
      await c.load('2026-05', [{ j: 1, net: '100' }]);
    },
  },
  {
    id: 'S32',
    async run(_f, { seed }) {
      const c = seed.sc(32, 1); // row A 50 (approved appendix); P 10 under a contract with a file, not approved
      await c.person('A', 'P');
      await c.track(1);
      await c.split(1, [['A', '50']]);
      const contract = await c.f.modules.owners.createDocument({
        kind: 'contract',
        title: 'Settlement contract 321 (not approved)',
        fileRef: 'dummy://contract-321.pdf',
        ownerId: null,
        requiresApproval: true,
      });
      c.keys.documents['unapproved-contract'] = contract.id;
      await c.part(1, 'P', '10', 'bucket', 'label_share', { doc: contract.id });
      await c.load('2026-03', [{ j: 1, net: '100' }]);
    },
  },
];
