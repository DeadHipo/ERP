import type { ComponentType, SVGProps } from 'react';
import {
  ArchiveBoxIcon,
  BanknotesIcon,
  BellAlertIcon,
  BuildingLibraryIcon,
  BuildingOffice2Icon,
  ChartPieIcon,
  ClockIcon,
  DocumentTextIcon,
  FolderOpenIcon,
  MegaphoneIcon,
  MusicalNoteIcon,
  QuestionMarkCircleIcon,
  ReceiptPercentIcon,
  RectangleStackIcon,
  ScaleIcon,
  TagIcon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { ru } from './i18n/ru';

export interface NavItem {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Path, optionally with a query string (`/owners?view=payouts`). */
  path: string;
  /** Optional count shown as a badge (from the overview). */
  badge?: number;
}

export interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
}

const items = ru.nav.items;

/** The sidebar, exactly as 17 §2. The breadcrumbs and the active highlight are derived from it. */
export const NAV: readonly NavSection[] = [
  {
    id: 'work',
    label: ru.nav.sections.work,
    items: [
      { id: 'overview', label: items.overview, icon: ChartPieIcon, path: '/' },
      { id: 'queue', label: items.queue, icon: ClockIcon, path: '/queue' },
      { id: 'signals', label: items.signals, icon: BellAlertIcon, path: '/signals' },
      { id: 'questions', label: items.questions, icon: QuestionMarkCircleIcon, path: '/questions' },
      { id: 'payouts', label: items.payouts, icon: BanknotesIcon, path: '/owners?view=payouts' },
    ],
  },
  {
    id: 'catalog',
    label: ru.nav.sections.catalog,
    items: [
      { id: 'tracks', label: items.tracks, icon: MusicalNoteIcon, path: '/tracks' },
      { id: 'releases', label: items.releases, icon: RectangleStackIcon, path: '/releases' },
      { id: 'owners', label: items.owners, icon: UsersIcon, path: '/owners' },
      { id: 'artists', label: items.artists, icon: UserGroupIcon, path: '/artists' },
    ],
  },
  {
    id: 'rules',
    label: ru.nav.sections.rules,
    items: [
      { id: 'splits', label: items.splits, icon: ScaleIcon, path: '/splits' },
      { id: 'participations', label: items.participations, icon: ReceiptPercentIcon, path: '/participations' },
      { id: 'labels', label: items.labels, icon: TagIcon, path: '/labels' },
      { id: 'publishing', label: items.publishing, icon: BuildingLibraryIcon, path: '/publishing' },
      { id: 'documents', label: items.documents, icon: DocumentTextIcon, path: '/documents' },
    ],
  },
  {
    id: 'money',
    label: ru.nav.sections.money,
    items: [
      { id: 'sources', label: items.sources, icon: ArchiveBoxIcon, path: '/sources' },
      { id: 'operations', label: items.operations, icon: FolderOpenIcon, path: '/operations' },
      { id: 'ads', label: items.ads, icon: MegaphoneIcon, path: '/ads' },
    ],
  },
];

/**
 * The system administrator's section (D-170, P24/P25): shown only to a system administrator (`Sidebar`), alone while
 * they work in no organization. Not part of `NAV` / `ALL_ITEMS` (the operator's sidebar), but of the breadcrumbs.
 */
export const SYSTEM_NAV: NavSection = {
  id: 'system',
  label: ru.nav.sections.system,
  items: [{ id: 'system-orgs', label: items.systemOrgs, icon: BuildingOffice2Icon, path: '/system/orgs' }],
};

/** The sections of the sidebar for the session: the operator's, plus the system section for a system administrator. */
export function navFor(session: { isSystemAdmin: boolean; inOrg: boolean }): readonly NavSection[] {
  if (!session.isSystemAdmin) return NAV;
  return session.inOrg ? [...NAV, SYSTEM_NAV] : [SYSTEM_NAV];
}

const BREADCRUMB_SECTIONS: readonly NavSection[] = [...NAV, SYSTEM_NAV];
const BREADCRUMB_ITEMS: readonly NavItem[] = BREADCRUMB_SECTIONS.flatMap((s) => s.items);

/** Sub-pages that are not sidebar items but have a fixed breadcrumb label. */
export const SUBPAGES: Readonly<Record<string, string>> = {
  '/sources/lines': ru.nav.subpages.sourceLines,
  '/artists/duplicates': ru.nav.subpages.artistDuplicates,
  '/dev/states': ru.nav.subpages.states,
};

export const ALL_ITEMS: readonly NavItem[] = NAV.flatMap((s) => s.items);

function splitPath(path: string): { pathname: string; params: URLSearchParams } {
  const [pathname = '/', query = ''] = path.split('?');
  return { pathname, params: new URLSearchParams(query) };
}

/** Is this sidebar item the current one? An item with a query (`view=payouts`) wins over the same path without it. */
export function isItemActive(item: NavItem, pathname: string, search: string): boolean {
  const target = splitPath(item.path);
  const current = new URLSearchParams(search);
  const onPath =
    target.pathname === '/' ? pathname === '/' : pathname === target.pathname || pathname.startsWith(`${target.pathname}/`);
  if (!onPath) return false;
  const wantedView = target.params.get('view');
  if (wantedView) return pathname === target.pathname && current.get('view') === wantedView;
  // A plain item is not active on the query view of another item that shares its path.
  const sharesPathWithQueryItem = ALL_ITEMS.some(
    (other) => other.id !== item.id && splitPath(other.path).pathname === target.pathname && other.path.includes('?'),
  );
  if (sharesPathWithQueryItem && pathname === target.pathname && current.get('view')) return false;
  return true;
}

export function activeItem(pathname: string, search: string): NavItem | undefined {
  return BREADCRUMB_ITEMS.find((i) => isItemActive(i, pathname, search));
}

export interface Crumb {
  label: string;
  to?: string;
  /** True for the entity crumb, whose label a detail page may replace (`useBreadcrumbLabel`). */
  entity?: boolean;
}

/** Breadcrumbs from nav.ts: section, item, then the sub-page label or the entity key of a detail route. */
export function crumbsFor(pathname: string, search: string): Crumb[] {
  const item = activeItem(pathname, search);
  if (!item) return [];
  const section = BREADCRUMB_SECTIONS.find((s) => s.items.some((i) => i.id === item.id));
  const crumbs: Crumb[] = [];
  if (section) crumbs.push({ label: section.label });
  const base = splitPath(item.path).pathname;
  crumbs.push({ label: item.label, to: pathname === base ? undefined : item.path });
  if (pathname !== base) {
    const sub = SUBPAGES[pathname];
    if (sub) crumbs.push({ label: sub });
    else {
      const rest = pathname.slice(base === '/' ? 1 : base.length + 1);
      crumbs.push({ label: decodeURIComponent(rest.split('/')[0] ?? rest), entity: true });
    }
  }
  return crumbs;
}
