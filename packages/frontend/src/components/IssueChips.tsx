import { Chip } from '@heroui/react';
import { ru } from '../i18n/ru';

/** One class of an import row as the API gives it (P28 split import, P29 operation import). */
export type ImportIssue = { code: string; severity: 'error' | 'warning' | 'info'; details?: Record<string, unknown> };

const COLOR = { error: 'danger', warning: 'warning', info: 'default' } as const;

/**
 * The classes of an import row as chips `issue-<code>` with `data-severity` (the severity is the backend's); `text` is
 * the page's sentence of a class (its dictionary, plus the number a class carries).
 */
export function IssueChips<I extends ImportIssue>({ issues, text }: { issues: readonly I[]; text: (issue: I) => string }) {
  return (
    <span className="flex flex-wrap gap-1 py-1">
      {issues.map((i, n) => (
        <Chip
          key={`${i.code}-${n}`}
          data-testid={`issue-${i.code}`}
          data-severity={i.severity}
          color={COLOR[i.severity]}
          size="sm"
          variant="soft"
          title={ru.common.severity[i.severity]}
        >
          {text(i)}
        </Chip>
      ))}
    </span>
  );
}
