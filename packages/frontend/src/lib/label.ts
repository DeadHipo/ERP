import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMe } from '../api/queries/auth';
import { ru } from '../i18n/ru';
import { readStorage, writeStorage } from './storage';

/** The storage key of the label switch (D-168): the id of an own label, '' = «Все» (every label). */
export const LABEL_KEY = 'erp.label';
const EVENT = 'erp:label';
/** The query parameter that carries the label view; the URL wins over the stored value. */
export const LABEL_PARAM = 'label';

export function getStoredLabel(): string {
  return (readStorage('local', LABEL_KEY) ?? '').trim();
}

export function setStoredLabel(id: string): void {
  writeStorage('local', LABEL_KEY, id.trim());
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * The label the operator works under (D-168): `?label=` of the URL when present (a shared link reproduces the view),
 * else the stored switch value. Setting it writes both. `labelId` '' means «Все»: the reads carry no `label=`, the
 * balances show every book, the payout button is unavailable.
 */
export function useLabel(): { labelId: string; requested: string; setLabel: (id: string) => void } {
  const [params, setParams] = useSearchParams();
  const stored = useSyncExternalStore(subscribe, getStoredLabel, () => '');
  const fromUrl = params.get(LABEL_PARAM);
  const me = useMe().data;
  const asked = fromUrl ?? stored;
  // a label manager (D-171) never reads under «Все» or another label: their first label until the shell's
  // `ForeignLabelReset` stores it, so no request goes out with a label the API refuses
  const labelId =
    me && me.authMode === 'on' && !me.allLabels && !me.labels.some((l) => l.id === asked) ? (me.labels[0]?.id ?? asked) : asked;
  // the URL wins: a link with `?label=` moves the switch. Only when the URL value changes: `setLabel('')` writes the
  // storage before the URL loses `label=`, and syncing on every render would write the old URL value back (D-169).
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (fromUrl !== null && fromUrl !== synced.current && fromUrl !== getStoredLabel()) setStoredLabel(fromUrl);
    synced.current = fromUrl;
  }, [fromUrl]);
  const setLabel = useCallback(
    (id: string) => {
      setStoredLabel(id);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set(LABEL_PARAM, id);
          else next.delete(LABEL_PARAM);
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  /** `requested`: the label of the URL or the storage as it is (the shell drops one the session may not choose). */
  return { labelId, requested: asked, setLabel };
}

/** The label view as a query object to spread into a read (`label=<id>`), nothing under «Все». */
export const labelQuery = (labelId: string): { label?: string } => (labelId ? { label: labelId } : {});

/**
 * The label a write is made under (D-169): the switch of the header. Under «Все» every write that needs a label (an
 * upload, a payout) is closed, and `reason` says why next to the button: one rule instead of a check per page.
 */
export function useWriteLabel(): { labelId: string; closed: boolean; reason: string } {
  const { labelId } = useLabel();
  return { labelId, closed: labelId === '', reason: ru.shell.label.pick };
}
