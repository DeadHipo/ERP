import type { ReactNode } from 'react';
import { Button } from '@heroui/react';
import type { OperationKey } from '../api/coverage';
import { useAllowed } from '../lib/abilities';
import { useOperator } from '../lib/operator';
import { ru } from '../i18n/ru';

interface CommonProps {
  name: string;
  children: ReactNode;
  onPress: () => void;
  isPending?: boolean;
  /** Disabled by a gate field of the API response; `reason` is shown next to the button. */
  isDisabled?: boolean;
  reason?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'tertiary';
  /**
   * In a grid row: the reason of a disabled button is its tooltip, not a text beside it (a list of 50 rows does not
   * repeat «укажите оператора» 50 times; the page says it once, `OperatorNotice`).
   */
  compact?: boolean;
}

/**
 * A write names the API operation it triggers (D-171, FIX-8): `op` is required by the type, and the button is closed
 * («нет права») when the key is not in `me.abilities`. A read-only action (a filter, a page, a dialog that does not
 * write) is `write={false}`: it needs no operator and no operation (`tests/action-ops.test.ts` lists them by name).
 */
type ActionButtonProps = CommonProps &
  ({ write?: true; op: OperationKey } | { write: false; op?: OperationKey });

/**
 * Every action of 17 §6 is one of these: `data-testid="action-<name>"`, disabled while its mutation is in flight
 * (a double click sends one request), for a write while no operator is set (R5), and while the session may not call
 * its operation (D-171). The reason beside it: no operator first, then an explicit reason of a disabled button, then
 * «нет права».
 */
export function ActionButton(props: ActionButtonProps) {
  const { hasOperator } = useOperator();
  const allowed = useAllowed(props.op);
  const needsOperator = props.write !== false && !hasOperator;
  const disabled = props.isPending === true || props.isDisabled === true || needsOperator || !allowed;
  const reason = needsOperator
    ? ru.shell.operator.hint
    : props.isDisabled === true && props.reason
      ? props.reason
      : !allowed
        ? ru.shell.role.closed
        : props.reason;
  return (
    <span className="inline-flex items-center gap-2" title={props.compact && disabled && reason ? reason : undefined}>
      <Button
        data-testid={`action-${props.name}`}
        data-op={props.op}
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
