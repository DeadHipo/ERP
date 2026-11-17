import type { z } from 'zod';
import type { recoupScopeSchema } from '@erp/shared/api-responses';
import { fmt, ru } from '../../i18n/ru';
import { formatCount } from '../../lib/money';

type Scope = z.output<typeof recoupScopeSchema>;
const t = ru.money.actions;

/**
 * The recoup scope of an advance or a deduction as one line (D-227): the kind, the ISRCs of kind `isrcs`, and
 * «…, кроме N ISRC» when ISRCs are excluded. The same text in P20, the owner's and the pseudonym's positions.
 */
export function scopeText(scope: Scope | null): string {
  if (!scope) return '—';
  const base = t.scopes[scope.kind as keyof typeof t.scopes] ?? scope.kind;
  const head = scope.isrcs?.length ? `${base}: ${scope.isrcs.join(', ')}` : base;
  return scope.excludeIsrcs?.length ? fmt(t.scopeExcept, { scope: head, count: formatCount(scope.excludeIsrcs.length) }) : head;
}

/** The excluded ISRCs one per line (the tooltip of the cell); undefined without exclusions. */
export function scopeTitle(scope: Scope | null): string | undefined {
  return scope?.excludeIsrcs?.length ? scope.excludeIsrcs.join('\n') : undefined;
}

/** Splits a typed or pasted list (commas, spaces, new lines, semicolons) into upper-case ISRCs without repeats. */
export function parseIsrcList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const v = raw.trim().toUpperCase();
    if (v !== '' && !out.includes(v)) out.push(v);
  }
  return out;
}
