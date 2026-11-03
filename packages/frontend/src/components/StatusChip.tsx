import { Chip } from '@heroui/react';
import { ru } from '../i18n/ru';

type Color = 'default' | 'accent' | 'success' | 'warning' | 'danger';
type Entry = { label: string; color: Color };

const entries = <K extends string>(labels: Record<K, string>, colors: Record<K, Color>): Record<string, Entry> =>
  Object.fromEntries((Object.keys(labels) as K[]).map((k) => [k, { label: labels[k], color: colors[k] }]));

/** One table: enum kind -> value -> label and colour. Labels come from the dictionary (`ru.status`, `ru.reasons`). */
const TABLE = {
  documentStatus: entries(ru.status.documentStatus, { not_attached: 'warning', not_approved: 'warning', approved: 'success', missing: 'danger' }),
  documentKind: entries(ru.status.documentKind, {
    contract: 'default', appendix: 'default', buyout: 'default', advance_basis: 'default', adjustment_basis: 'default',
    payment_proof: 'default', return_proof: 'default', other: 'default', assumption: 'warning',
  }),
  ownerStatus: entries(ru.status.ownerStatus, { confirmed: 'success', waiting_documents: 'warning' }),
  artistStatus: entries(ru.status.artistStatus, { confirmed: 'success', unconfirmed: 'warning', no_owner: 'danger' }),
  category: entries(ru.status.category, { B: 'success', C: 'warning' }),
  cReason: Object.fromEntries(
    Object.entries(ru.reasons).map(([k, label]): [string, Entry] => [k, { label, color: k === 'assumption' ? 'accent' : 'warning' }]),
  ),
  operationMeaning: entries(ru.status.operationMeaning, {
    payout: 'success', recoupable_payout: 'accent', deduction: 'warning', credit: 'default', return: 'danger',
  }),
  fileStatus: entries(ru.status.fileStatus, { loading: 'accent', loaded: 'success', failed: 'danger', superseded: 'default' }),
  signal: Object.fromEntries(
    Object.entries(ru.signals).map(([k, label]): [string, Entry] => [k, { label, color: 'warning' }]),
  ),
} as const;

export type StatusKind = keyof typeof TABLE;

/** One chip for every status-like enum; `data-testid="chip-<value>"`. An unknown value shows as it is (default colour). */
export function StatusChip({ kind, value }: { kind: StatusKind; value: string }) {
  const entry = TABLE[kind][value] ?? { label: value, color: 'default' as const };
  return (
    <Chip data-testid={`chip-${value}`} color={entry.color} size="sm" variant="soft">
      {entry.label}
    </Chip>
  );
}

/** Used by tests: the label a chip would show. */
export function statusLabel(kind: StatusKind, value: string): string {
  return TABLE[kind][value]?.label ?? value;
}
