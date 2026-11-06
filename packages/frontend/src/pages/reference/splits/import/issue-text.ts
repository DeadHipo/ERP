import type { SplitImport } from './types';
import { fmt, ru } from '../../../../i18n/ru';

const t = ru.splitImport;
type Issue = SplitImport['rows'][number]['issues'][number];

/** The text of one class of the split import: the sentence, plus the number it carries (our share, the sum, the floored dates). */
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
