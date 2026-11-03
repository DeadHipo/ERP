import { useSyncExternalStore } from 'react';
import { readStorage, writeStorage } from './storage';

/** The key is shared with the legacy client, which reads it too. */
export const OPERATOR_KEY = 'erp.operator';
const EVENT = 'erp:operator';

export function getOperator(): string {
  return (readStorage('local', OPERATOR_KEY) ?? '').trim();
}

export function setOperator(name: string): void {
  writeStorage('local', OPERATOR_KEY, name.trim());
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

/** The operator name (R5): every write sends it as X-Operator; empty means every write button is disabled. */
export function useOperator(): { operator: string; hasOperator: boolean; setOperator: (name: string) => void } {
  const operator = useSyncExternalStore(subscribe, getOperator, () => '');
  return { operator, hasOperator: operator.length > 0, setOperator };
}
