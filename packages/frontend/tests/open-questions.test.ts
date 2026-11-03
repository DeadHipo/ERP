import { describe, expect, it } from 'vitest';
import { OPEN_QUESTIONS } from '@erp/shared/open-questions';
import { C_REASONS } from '@erp/shared/api-responses';
import { ALL_ITEMS, SUBPAGES } from '../src/nav';
import { ru } from '../src/i18n/ru';

// P3: the open items are exactly 15.3.1 … 15.3.14 of docs/agents/15_mvp_report.md §3, each with a link to a route.
const pathOf = (link: string) => link.split('?')[0] ?? link;
const ROUTES = new Set([
  ...ALL_ITEMS.map((i) => pathOf(i.path)),
  ...Object.keys(SUBPAGES),
  ...C_REASONS.map((r) => `/queue/${r}`),
  ...Object.keys(ru.signals).map((n) => `/signals/${n}`),
]);

describe('OPEN_QUESTIONS', () => {
  it('has the ids 15.3.1 … 15.3.14 in order', () => {
    expect(OPEN_QUESTIONS.map((q) => q.id)).toEqual(Array.from({ length: 14 }, (_, i) => `15.3.${i + 1}`));
  });

  it('links every item to a route of the app', () => {
    for (const q of OPEN_QUESTIONS) expect(ROUTES.has(pathOf(q.link)), `${q.id} ${q.link}`).toBe(true);
  });

  it('names decisions as D-nnn and has a title and a note', () => {
    for (const q of OPEN_QUESTIONS) {
      for (const d of q.decisionIds) expect(d).toMatch(/^D-\d{3}$/);
      expect(q.title.length).toBeGreaterThan(0);
      expect(q.note.length).toBeGreaterThan(0);
    }
  });

  it('carries no amounts', () => {
    for (const q of OPEN_QUESTIONS) expect(`${q.title} ${q.note}`).not.toMatch(/\d[\d ,.]*\d{3}/);
  });
});
