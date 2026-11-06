import { describe, expect, it } from 'vitest';
import { API_OPERATIONS, operationKey } from '../../backend/src/api/operations';
import { filesUnder, read } from './helpers';

// D-171, FIX-8: a write button names the operation it triggers (`ActionButton op`, required by the type), so the button
// is closed when `me.abilities` lacks it. The buttons without an operation are read-only (`write={false}`: filters,
// paging, opening a local editor or a dialog that does not write) and are listed here by name: a new one fails until
// it is either given its `op` or added to this list on purpose.
const WITHOUT_OP = [
  'ads-apply',
  'ads-reset',
  'breakdown',
  'catalog-current',
  'create-pick-next',
  'duplicate-same',
  'edit-note',
  'expand-month',
  'files-all',
  'files-newest',
  'files-none',
  'note-cancel',
  'onboarding-collapse',
  'operations-apply',
  'operations-reset',
  'operation-import-template',
  'page-next',
  'page-prev',
  'period-apply',
  'period-reset',
  'queue-apply',
  'queue-reset',
  'reset-lines',
  'show-lines',
  'split-add-row',
  'split-import-template',
  'start-import-template',
  'split-remove-row-${i}',
  'split-row-drop-document-${i}',
];

/** Every `<ActionButton …>` opening tag of `src`, with its name attribute as written. */
function buttons(): { file: string; name: string; tag: string }[] {
  const out: { file: string; name: string; tag: string }[] = [];
  for (const file of filesUnder('src', /\.tsx$/)) {
    const text = read(file);
    for (const m of text.matchAll(/<ActionButton\b/g)) {
      let depth = 0;
      let j = m.index + m[0].length;
      for (; j < text.length; j++) {
        const c = text[j];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === '>' && depth === 0 && text[j - 1] !== '=') break;
      }
      const tag = text.slice(m.index, j);
      const name = /\bname=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/.exec(tag);
      out.push({ file, name: name?.[1] ?? name?.[2] ?? name?.[3] ?? '?', tag });
    }
  }
  return out;
}

describe('ActionButton op (D-171)', () => {
  const all = buttons();

  it('finds the buttons', () => {
    expect(all.length).toBeGreaterThan(100);
  });

  it('lists every button without an operation by name, and each of them is read-only', () => {
    const without = all.filter((b) => !/\bop=/.test(b.tag));
    expect([...new Set(without.map((b) => b.name))].sort()).toEqual([...WITHOUT_OP].sort());
    expect(without.filter((b) => !b.tag.includes('write={false}')).map((b) => `${b.file}: ${b.name}`)).toEqual([]);
  });

  it('names only operations of operations.ts', () => {
    const keys = new Set(API_OPERATIONS.map(operationKey));
    const literal = all.flatMap((b) => [...b.tag.matchAll(/\bop="([^"]*)"/g)].map((m) => m[1] ?? ''));
    expect(literal.length).toBeGreaterThan(80);
    expect(literal.filter((k) => !keys.has(k))).toEqual([]);
  });
});
