import { describe, expect, it } from 'vitest';
import { balanceSchema, C_REASONS, reconciliationRowSchema } from '@erp/shared/api-responses';
import { REASON_LABELS } from '@erp/shared/reasons';

// Every category C reason the backend can produce has a human label for the pages (D-129).

describe('C reasons', () => {
  it('every reason has a non-empty label and no label is left over', () => {
    for (const r of C_REASONS) expect(REASON_LABELS[r], r).toBeTruthy();
    expect(Object.keys(REASON_LABELS).sort()).toEqual([...C_REASONS].sort());
  });

  it('reconciliation and balance breakdowns accept only the reasons of the enum', () => {
    const recon = {
      source: 'believe',
      account: '1',
      month: '2026-07',
      A_received: '0',
      B_notOurs: '0',
      C_waiting: '0',
      ourShare: '0',
      ourShareByLabel: {},
      ourShareNoSplit: '0',
      discrepancy: '0',
      fileTotal: null,
      fileDiscrepancy: null,
    };
    expect(reconciliationRowSchema.safeParse({ ...recon, C_breakdown: { assumption: '1' } }).success).toBe(true);
    expect(reconciliationRowSchema.safeParse({ ...recon, C_breakdown: { made_up: '1' } }).success).toBe(false);
    const shape = balanceSchema.shape.period.shape.waitingBreakdown;
    expect(shape.safeParse({ label_unmapped: '2' }).success).toBe(true);
    expect(shape.safeParse({ made_up: '2' }).success).toBe(false);
  });
});
