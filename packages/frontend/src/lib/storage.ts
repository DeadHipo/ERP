/** localStorage / sessionStorage can be missing or throw (private window, blocked site data): never let it break a page. */
export function readStorage(kind: 'local' | 'session', key: string): string | null {
  try {
    return (kind === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(kind: 'local' | 'session', key: string, value: string): void {
  try {
    (kind === 'local' ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    /* storage unavailable: the value just is not remembered */
  }
}
