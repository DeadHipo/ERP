import type { Scenario } from './index';

// S18 (G26a-e, publishing_terms_unconfirmed) and S19 (writer_unmapped): the B17 lines are collected and loaded last.

export const publishing: Scenario[] = [
  {
    id: 'S18',
    async run(f, { seed }) {
      const c = seed.sc(18, 1);
      // Confirmed owners W1, W2, W3; the alias is the writer name used in the statement.
      for (const w of ['W1', 'W2', 'W3']) await c.confirmed(w, [w], { aliases: [c.pseud(w)] });
      const terms = async (w: string, percent: string, name: string, operationType?: string) =>
        f.setPublishingTerms({
          ownerId: c.owner(w),
          percent,
          validFrom: '2020-01-01',
          documentId: await c.doc('contract', name, w),
          operationType: operationType ?? null,
        });
      await terms('W1', '50', 'terms-W1');
      await terms('W2', '90', 'terms-W2');
      await terms('W2', '50', 'terms-W2-sync', 'Synchronization');
      const w = (l: string) => c.pseud(l);
      const holder = 'HOLDER H-181';
      c.b17({ title: 'T-A-181', writer: holder, songwriters: `${w('W1')}, ${w('W2')}`, payable: '100', operationType: 'Mechanical', period: '1Q26' });
      c.b17({ title: 'T-B-181', writer: holder, songwriters: `${w('W1')}, ${w('W2')}`, payable: '100', operationType: 'Synchronization', period: '1Q26' });
      c.b17({ title: 'T-C-181', writer: holder, songwriters: `${w('W1')}, X-181`, payable: '100', operationType: 'Mechanical', period: '1Q26' });
      c.b17({ title: 'T-D-181', writer: holder, songwriters: w('W3'), payable: '100', operationType: 'Mechanical', period: '1Q26' });
    },
  },
  {
    id: 'S19',
    async run(f, { seed }) {
      const c = seed.sc(19, 1);
      // Two confirmed person owners share the alias HOLDER W4: the holder is ambiguous. W4a has approved terms 50.
      await c.confirmed('W4a', ['W4a'], { aliases: ['HOLDER W4'] });
      await c.confirmed('W4b', ['W4b'], { aliases: ['HOLDER W4'] });
      await f.setPublishingTerms({
        ownerId: c.owner('W4a'),
        percent: '50',
        validFrom: '2020-01-01',
        documentId: await c.doc('contract', 'terms-W4a', 'W4a'),
      });
      c.keys.extra.holder = 'HOLDER W4';
      c.b17({ title: 'Song-191', writer: 'HOLDER W4', payable: '100', period: '4Q25' });
    },
  },
];
