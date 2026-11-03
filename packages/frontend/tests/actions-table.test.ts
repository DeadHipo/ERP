import { describe, expect, it } from 'vitest';
import { C_REASONS, signalsSchema } from '@erp/shared/api-responses';
import { REASON_ACTIONS, SIGNAL_ACTIONS, type ActionEntry } from '../src/pages/work/actions/action-table';
import * as dialogs from '../src/pages/work/actions/dialogs';

const signalNames = Object.keys(signalsSchema.shape).filter((k) => k !== 'counts');

function check(table: Record<string, ActionEntry>) {
  for (const [name, entry] of Object.entries(table)) {
    if (entry.information) {
      expect(entry.note.length, `${name} note`).toBeGreaterThan(10);
    } else {
      for (const d of [entry.action, ...(entry.also ?? [])]) {
        expect(Object.keys(dialogs), `${name}: ${d}`).toContain(d);
        expect(typeof (dialogs as Record<string, unknown>)[d], `${name}: ${d}`).toBe('function');
      }
    }
  }
}

describe('reason and signal action tables', () => {
  it('has an entry for every C reason and nothing else', () => {
    expect(Object.keys(REASON_ACTIONS).sort()).toEqual([...C_REASONS].sort());
  });

  it('has an entry for every signal list and nothing else', () => {
    expect(signalNames.length).toBeGreaterThan(5);
    expect(Object.keys(SIGNAL_ACTIONS).sort()).toEqual([...signalNames].sort());
  });

  it('names existing dialog components', () => {
    check(REASON_ACTIONS);
    check(SIGNAL_ACTIONS);
  });
});
