import { describe, expect, it } from 'vitest';
import { CONTRACT_DOCUMENT_KINDS, DOCUMENT_KINDS, SPLIT_DOCUMENT_KINDS } from '@erp/shared/document-kinds';
import {
  ALL_DOCUMENT_KINDS,
  BUYOUT_STEP_KINDS,
  CONTRACT_STEP_KINDS,
  OWNER_DOCUMENT_KINDS,
  SPLIT_STEP_KINDS,
} from '../src/lib/document-kinds';
import { ru } from '../src/i18n/ru';
import { read } from './helpers';

// D-172 (FIX-10): the kinds a dialog offers come from the one list of `@erp/shared/document-kinds`; the six dialogs that
// had a list of their own take it from `lib/document-kinds.ts`, so `label_decision` reaches every one of them.
const sorted = (xs: readonly string[]) => [...xs].sort();
const withoutAssumption = (xs: readonly string[]) => xs.filter((k) => k !== 'assumption');

describe('document kinds of the dialogs (D-172)', () => {
  it('derives every list from the shared ones', () => {
    expect(ALL_DOCUMENT_KINDS).toEqual(DOCUMENT_KINDS);
    expect(SPLIT_STEP_KINDS).toEqual(withoutAssumption(SPLIT_DOCUMENT_KINDS));
    expect(SPLIT_STEP_KINDS[0]).toBe('appendix');
    expect(sorted(BUYOUT_STEP_KINDS)).toEqual(sorted(SPLIT_STEP_KINDS));
    expect(BUYOUT_STEP_KINDS[0]).toBe('buyout');
    expect(CONTRACT_STEP_KINDS).toEqual(CONTRACT_DOCUMENT_KINDS);
    expect(OWNER_DOCUMENT_KINDS).toEqual(withoutAssumption(DOCUMENT_KINDS));
    for (const list of [SPLIT_STEP_KINDS, BUYOUT_STEP_KINDS, CONTRACT_STEP_KINDS, OWNER_DOCUMENT_KINDS]) expect(list).toContain('label_decision');
  });

  it('has a Russian label for every kind', () => {
    const labels = ru.status.documentKind as Record<string, string>;
    for (const k of DOCUMENT_KINDS) expect(labels[k], k).toMatch(/[а-яё]/i);
  });

  it('keeps no hard-coded kind list in the six dialogs and the documents page', () => {
    const files = {
      'src/pages/catalog/track/SplitDialogs.tsx': ['SPLIT_STEP_KINDS', 'BUYOUT_STEP_KINDS'],
      'src/pages/catalog/track/ParticipationDialogs.tsx': ['SPLIT_STEP_KINDS'],
      'src/pages/work/actions/dialogs.tsx': ['SPLIT_STEP_KINDS'],
      'src/pages/reference/artists/CreateSplitForArtistDialog.tsx': ['SPLIT_STEP_KINDS'],
      'src/pages/owners/DocumentsTab.tsx': ['OWNER_DOCUMENT_KINDS'],
      'src/pages/work/actions/owner-dialogs.tsx': ['CONTRACT_STEP_KINDS'],
      'src/pages/reference/documents/DocumentDialogs.tsx': ['ALL_DOCUMENT_KINDS'],
    };
    for (const [file, lists] of Object.entries(files)) {
      const text = read(file);
      for (const list of lists) expect(text, `${file} uses ${list}`).toContain(list);
      // a literal list of kinds: `['appendix', …]` or `kinds={['contract']}`
      expect(text, file).not.toMatch(/\[\s*'(?:contract|appendix|buyout|other|label_decision)'/);
    }
  });
});
