import { useCallback, useState } from 'react';
import { readStorage, writeStorage } from './storage';

const KEY = 'erp.theme';

/** Light by default; `html.dark` switches the HeroUI tokens. The saved choice is applied by a script in index.html. */
export function useTheme(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    writeStorage('local', KEY, next ? 'dark' : 'light');
    setDark(next);
  }, []);
  return { dark, toggle };
}

export function savedThemeIsDark(): boolean {
  return readStorage('local', KEY) === 'dark';
}
