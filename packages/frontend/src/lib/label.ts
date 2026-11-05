import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useSearchParams } from 'react-router-dom';
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
export function useLabel(): { labelId: string; setLabel: (id: string) => void } {
  const [params, setParams] = useSearchParams();
  const stored = useSyncExternalStore(subscribe, getStoredLabel, () => '');
  const fromUrl = params.get(LABEL_PARAM);
  const labelId = fromUrl ?? stored;
  // the URL wins: a link with `?label=` moves the switch
  useEffect(() => {
    if (fromUrl !== null && fromUrl !== stored) setStoredLabel(fromUrl);
  }, [fromUrl, stored]);
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
  return { labelId, setLabel };
}

/** The label view as a query object to spread into a read (`label=<id>`), nothing under «Все». */
export const labelQuery = (labelId: string): { label?: string } => (labelId ? { label: labelId } : {});
