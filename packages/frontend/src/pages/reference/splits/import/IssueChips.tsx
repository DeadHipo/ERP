import { Chip } from '@heroui/react';
import type { SplitImport } from './types';
import { fmt, ru } from '../../../../i18n/ru';

const t = ru.splitImport;
type Issue = SplitImport['rows'][number]['issues'][number];

const COLOR = { error: 'danger', warning: 'warning', info: 'default' } as const;

/** The text of one class: the sentence, plus the number it carries (our share, the sum, the floored dates). */
export function issueText(issue: Issue): string {
  const base = t.issues[issue.code];
  const d = issue.details ?? {};
  const value = (k: string) => (typeof d[k] === 'string' || typeof d[k] === 'number' ? String(d[k]) : null);
  if (issue.code === 'our_share' && value('ourShare')) return `${base}: ${value('ourShare')} %`;
  if (issue.code === 'split_sum_above_100' && value('sum')) return `${base}: ${value('sum')} %`;
  if (issue.code === 'replaces' && value('from')) return `${base} ${fmt(ru.splitImport.from, { from: value('from') ?? '' })}`;
  if (issue.code === 'isrc_outside_label' && value('labelName')) return `${base} (${value('labelName')})`;
  return base;
}

/** The classes of a row as chips `issue-<code>` with `data-severity`; the severity is the backend's. */
export function IssueChips({ issues }: { issues: readonly Issue[] }) {
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
          title={t.severity[i.severity]}
        >
          {issueText(i)}
        </Chip>
      ))}
    </span>
  );
}
