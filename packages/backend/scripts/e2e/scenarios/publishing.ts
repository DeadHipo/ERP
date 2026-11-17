import type { Scenario } from './index';

// S18 (G26 under v2, publishing_terms_unconfirmed) and S19 (writer_unmapped): the rows of the report summaries are
// collected and loaded last (D-234: the summaries of v2; a row belongs to its rights-holder, the songwriter of v2,
// whose owner is the operator's link).

export const publishing: Scenario[] = [
  {
    id: 'S18',
    async run(f, { seed }) {
      const c = seed.sc(18, 1);
      for (const w of ['W1', 'W2', 'W3']) await c.confirmed(w, [w], { aliases: [c.pseud(w)] });
      const terms = async (w: string, percent: string, name: string) =>
        f.setPublishingTerm(
          { ownerId: c.owner(w), percent, validFrom: '2020-01-01', documentId: await c.doc('contract', name, w) },
          'e2e-seed',
        );
      await terms('W1', '50', 'terms-W1');
      await terms('W2', '90', 'terms-W2');
      // W3 is linked but has no term: its row waits in C publishing_terms_unconfirmed at the default 50 %
      c.b17({ title: 'T-A-181', writer: c.pseud('W1'), owner: c.owner('W1'), payable: '100', period: '1Q26' });
      c.b17({ title: 'T-B-181', writer: c.pseud('W2'), owner: c.owner('W2'), payable: '100', period: '1Q26' });
      c.b17({ title: 'T-D-181', writer: c.pseud('W3'), owner: c.owner('W3'), payable: '100', period: '1Q26' });
    },
  },
  {
    id: 'S19',
    async run(f, { seed }) {
      const c = seed.sc(19, 1);
      // The songwriter HOLDER W4 is not linked: its row waits in C writer_unmapped. W4a has approved terms 50.
      await c.confirmed('W4a', ['W4a'], { aliases: ['HOLDER W4'] });
      await c.confirmed('W4b', ['W4b'], { aliases: ['HOLDER W4'] });
      await f.setPublishingTerm(
        { ownerId: c.owner('W4a'), percent: '50', validFrom: '2020-01-01', documentId: await c.doc('contract', 'terms-W4a', 'W4a') },
        'e2e-seed',
      );
      c.keys.extra.holder = 'HOLDER W4';
      c.b17({ title: 'Song-191', writer: 'HOLDER W4', payable: '100', period: '4Q25' });
    },
  },
];
