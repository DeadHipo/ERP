import { useSyncExternalStore } from 'react';
import { readStorage, writeStorage } from './storage';

// The session of the browser tab (D-170). `GET /auth/me` says who is signed in; the client sends `X-Org` only for a
// system administrator who chose an organization to work in («Работать в организации», `sessionStorage` `erp.org`).

/** The `sessionStorage` key of the organization a system administrator works in ('' = none chosen). */
export const ORG_KEY = 'erp.org';
const EVENT = 'erp:org';

let systemAdmin = false;

/** Set from the answer of `GET /auth/me` (and of the login): only a system administrator ever sends `X-Org`. */
export function setSessionSystemAdmin(isSystemAdmin: boolean): void {
  systemAdmin = isSystemAdmin;
}

export function getWorkOrg(): string {
  return (readStorage('session', ORG_KEY) ?? '').trim();
}

/** Chooses (or with '' leaves) the organization a system administrator works in. */
export function setWorkOrg(id: string): void {
  writeStorage('session', ORG_KEY, id.trim());
  window.dispatchEvent(new Event(EVENT));
}

/** The value of the `X-Org` header of a request, or undefined: a user of an organization never sends it. */
export function orgHeader(): string | undefined {
  if (!systemAdmin) return undefined;
  return getWorkOrg() || undefined;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** The organization a system administrator works in ('' = none: only the system pages are open). */
export function useWorkOrg(): string {
  return useSyncExternalStore(subscribe, getWorkOrg, () => '');
}

/** The path a 401 leads to: `/login?next=<the current path>`. */
export function loginPath(next: string): string {
  return next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login';
}

/** A safe `next` after the login: a path of this app only (never `//host` or a full URL). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return '/';
  return next;
}
