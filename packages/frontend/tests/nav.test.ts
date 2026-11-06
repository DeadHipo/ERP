import { describe, expect, it } from 'vitest';
import { ALL_ITEMS, NAV, activeItem, crumbsFor, homeFor, isItemActive, navFor } from '../src/nav';
import { plural, fmt } from '../src/i18n/ru';

describe('nav.ts', () => {
  it('has the sections and items of 17 section 2', () => {
    expect(NAV.map((s) => s.items.map((i) => i.path))).toEqual([
      ['/', '/queue', '/signals', '/questions', '/owners?view=payouts'],
      ['/tracks', '/releases', '/owners', '/artists'],
      ['/splits', '/participations', '/labels', '/publishing', '/documents'],
      ['/sources', '/operations', '/ads'],
    ]);
    expect(new Set(ALL_ITEMS.map((i) => i.id)).size).toBe(ALL_ITEMS.length);
  });

  it('tells the payouts view from the owners list', () => {
    expect(activeItem('/owners', '?view=payouts')?.id).toBe('payouts');
    expect(activeItem('/owners', '')?.id).toBe('owners');
    expect(activeItem('/owners/abc', '')?.id).toBe('owners');
    const payouts = ALL_ITEMS.find((i) => i.id === 'payouts');
    expect(payouts && isItemActive(payouts, '/owners/abc', '')).toBe(false);
  });

  it('derives breadcrumbs', () => {
    expect(crumbsFor('/', '').map((c) => c.label)).toEqual(['Работа', 'Обзор']);
    expect(crumbsFor('/tracks/QZTST1', '').map((c) => c.label)).toEqual(['Каталог', 'Треки', 'QZTST1']);
    expect(crumbsFor('/sources/lines', '').map((c) => c.label)).toEqual(['Деньги', 'Отчёты', 'Строки отчётов']);
  });
});

describe('navFor (D-171)', () => {
  const ids = (sections: ReturnType<typeof navFor>) => sections.flatMap((s) => s.items.map((i) => i.id));

  it('shows everything with the login off and hides what me.abilities lacks with it on', () => {
    expect(ids(navFor({ isSystemAdmin: false, inOrg: true }, { authMode: 'off', abilities: [] }))).toContain('overview');
    const manager = navFor({ isSystemAdmin: false, inOrg: true }, { authMode: 'on', abilities: ['GET /signals', 'GET /owners'] });
    expect(ids(manager)).toEqual(['signals', 'questions', 'owners']);
    expect(homeFor(manager)).toBe('/signals');
    const admin = navFor({ isSystemAdmin: false, inOrg: true }, { authMode: 'on', abilities: ['GET /overview', 'GET /users'] });
    expect(ids(admin)).toEqual(['overview', 'queue', 'questions', 'users']);
  });

  it('gives a system administrator outside an organization the system section only', () => {
    const sys = navFor({ isSystemAdmin: true, inOrg: false }, { authMode: 'on', abilities: ['GET /orgs', 'GET /system/users'] });
    expect(ids(sys)).toEqual(['system-orgs', 'system-users']);
    expect(crumbsFor('/users', '').map((c) => c.label)).toEqual(['Организация', 'Пользователи']);
  });
});

describe('dictionary helpers', () => {
  it('plural', () => {
    const f = ['файл', 'файла', 'файлов'] as const;
    expect([1, 2, 5, 11, 21, 22, 25, 111].map((n) => plural(n, f))).toEqual([
      'файл', 'файла', 'файлов', 'файлов', 'файл', 'файла', 'файлов', 'файлов',
    ]);
  });
  it('fmt', () => {
    expect(fmt('Файлов: {n} из {total}', { n: 3, total: 7 })).toBe('Файлов: 3 из 7');
  });
});
