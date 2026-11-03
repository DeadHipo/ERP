import { useIsFetching } from '@tanstack/react-query';
import { Spinner } from '@heroui/react';
import { isMoneyKey } from '../api/queries/core';
import { ru } from '../i18n/ru';

/** "идёт пересчёт" while any money query is in flight (R2, 17 §2). */
export function RecalcIndicator() {
  const fetching = useIsFetching({ predicate: (q) => isMoneyKey(q.queryKey) });
  if (fetching === 0) return null;
  return (
    <span data-testid="recalc-indicator" className="inline-flex items-center gap-2 text-sm text-warning">
      <Spinner size="sm" />
      {ru.shell.recalc}
    </span>
  );
}
