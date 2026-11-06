import { describe, expect, it } from 'vitest';
import { C_REASONS, payoutGateSchema, signalsSchema } from '@erp/shared/api-responses';
import { REASON_LABELS } from '@erp/shared/reasons';
import { ru } from '../src/i18n/ru';
import { errors } from '../src/i18n/ru/errors';

describe('Russian dictionary coverage', () => {
  it('has a label for every C reason, different from the English one', () => {
    for (const reason of C_REASONS) {
      const label = ru.reasons[reason];
      expect(label, reason).toBeTruthy();
      expect(label, reason).not.toBe(REASON_LABELS[reason]);
      expect(/[а-яё]/i.test(label), `${reason} is Russian`).toBe(true);
    }
    expect(Object.keys(ru.reasons).sort()).toEqual([...C_REASONS].sort());
  });

  it('has a caption for every payout gate reason', () => {
    const reasons = payoutGateSchema.shape.reason.unwrap().options;
    expect(reasons).toContain('no_contract_for_label');
    for (const reason of reasons) {
      const caption = ru.status.payoutGate[reason];
      expect(caption, reason).toBeTruthy();
      expect(/[а-яё]/i.test(caption), `${reason} is Russian`).toBe(true);
      expect(errors[reason], `${reason} has an error sentence`).toBeTruthy();
    }
    expect(Object.keys(ru.status.payoutGate).sort()).toEqual([...reasons].sort());
  });

  it('has a label for every signal list', () => {
    const names = Object.keys(signalsSchema.shape).filter((n) => n !== 'counts'); // counts is a number map, not a list
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      expect(ru.signals[name as keyof typeof ru.signals], name).toBeTruthy();
    }
    expect(Object.keys(ru.signals).sort()).toEqual([...names].sort());
  });
});
