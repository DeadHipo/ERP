import type { ReactNode } from 'react';
import { Button } from '@heroui/react';
import { useOperator } from '../lib/operator';
import { ru } from '../i18n/ru';

/**
 * Every action of 17 §6 is one of these: `data-testid="action-<name>"`, disabled while its mutation is in flight
 * (a double click sends one request) and, for a write, while no operator is set (R5).
 */
export function ActionButton(props: {
  name: string;
  children: ReactNode;
  onPress: () => void;
  isPending?: boolean;
  /** Disabled by a gate field of the API response; `reason` is shown next to the button. */
  isDisabled?: boolean;
  reason?: string;
  /** A read-only action (e.g. open a dialog that does not write) does not need an operator. */
  write?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'tertiary';
  /**
   * In a grid row: the reason of a disabled button is its tooltip, not a text beside it (a list of 50 rows does not
   * repeat «укажите оператора» 50 times; the page says it once, `OperatorNotice`).
   */
  compact?: boolean;
}) {
  const { hasOperator } = useOperator();
  const needsOperator = props.write !== false && !hasOperator;
  const disabled = props.isPending === true || props.isDisabled === true || needsOperator;
  const reason = needsOperator ? ru.shell.operator.hint : props.reason;
  return (
    <span className="inline-flex items-center gap-2" title={props.compact && disabled && reason ? reason : undefined}>
      <Button
        data-testid={`action-${props.name}`}
        variant={props.variant ?? 'primary'}
        size="sm"
        isDisabled={disabled}
        isPending={props.isPending}
        onPress={props.onPress}
      >
        {props.children}
      </Button>
      {disabled && reason && !props.compact ? <span className="text-xs text-muted">{reason}</span> : null}
    </span>
  );
}

/** One line per page above a list of compact row buttons: no operator, so the write buttons of the rows are disabled. */
export function OperatorNotice() {
  const { hasOperator } = useOperator();
  if (hasOperator) return null;
  return (
    <div className="mb-2 text-sm text-danger" data-testid="operator-notice">
      {ru.shell.operator.rowsHint}
    </div>
  );
}
