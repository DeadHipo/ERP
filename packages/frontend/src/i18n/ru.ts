import { audit } from './ru/audit';
import { auth } from './ru/auth';
import { system } from './ru/system';
import { users } from './ru/users';
import { ads } from './ru/ads';
import { common } from './ru/common';
import { nav } from './ru/nav';
import { shell } from './ru/shell';
import { search } from './ru/search';
import { pageState } from './ru/pageState';
import { dialog } from './ru/dialog';
import { toast } from './ru/toast';
import { reasons } from './ru/reasons';
import { signals } from './ru/signals';
import { status } from './ru/status';
import { catalog } from './ru/catalog';
import { money } from './ru/money';
import { reference } from './ru/reference';
import { splitImport } from './ru/splitImport';
import { operations } from './ru/operations';
import { onboarding } from './ru/onboarding';
import { claude } from './ru/claude';
import { cuts } from './ru/cuts';
import { actions, overview, questions, queue, reasonActions, signalsPage } from './ru/work';

/** The one Russian dictionary of the interface, split by domain. A "t" is just importing `ru`. */
export const ru = {
  claude,
  cuts,
  common,
  nav,
  shell,
  search,
  pageState,
  dialog,
  toast,
  reasons,
  signals,
  status,
  overview,
  reasonActions,
  queue,
  signalsPage,
  questions,
  actions,
  catalog,
  money,
  reference,
  splitImport,
  operations,
  onboarding,
  audit,
  ads,
  auth,
  system,
  users,
} as const;

/** Russian plural form: `plural(21, ['файл', 'файла', 'файлов'])` gives `файл`. */
export function plural(n: number, [one, few, many]: readonly [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Replaces `{name}` placeholders: `fmt('Файлов: {n}', { n: 3 })`. */
export function fmt(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));
}
