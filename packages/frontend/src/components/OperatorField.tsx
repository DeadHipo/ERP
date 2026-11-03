import { useState } from 'react';
import { Input } from '@heroui/react';
import { useOperator } from '../lib/operator';
import { ru } from '../i18n/ru';

export { useOperator } from '../lib/operator';

/** The operator name (R5): typed once, kept in localStorage, sent as X-Operator on every write. Empty = red hint. */
export function OperatorField() {
  const { operator, hasOperator, setOperator } = useOperator();
  const [text, setText] = useState(operator);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="operator-field" className="text-sm text-muted">
        {ru.shell.operator.label}
      </label>
      <Input
        id="operator-field"
        data-testid="operator-field"
        aria-label={ru.shell.operator.label}
        placeholder={ru.shell.operator.placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOperator(e.target.value);
        }}
        className="w-40"
      />
      {hasOperator ? null : (
        <span data-testid="operator-hint" className="text-sm text-danger">
          {ru.shell.operator.hint}
        </span>
      )}
    </div>
  );
}
