import type { OperationKey } from '../../../api/coverage';

/**
 * The operation each row action of the queue (P2) and the signals (P21) leads to (D-171): the button is closed when
 * the session may not call it. An action that writes several times names the one that needs the most rights (a
 * sublabel rule creates the label, its alias and the rule: `POST /labels`).
 */
export const ACTION_OPS = {
  'create-contract': 'POST /contracts',
  merge: 'POST /owners/merge',
  'confirm-split': 'POST /splits/:id/confirm',
  'replace-assumption': 'POST /splits/change',
  'recreate-rule': 'POST /splits/change',
  approve: 'POST /documents/:id/approve',
  'assign-owner': 'POST /artists/:id/owner',
  'label-alias': 'POST /labels/:id/aliases',
  'sublabel-rule': 'POST /labels',
  'register-track': 'POST /tracks',
  'map-writer': 'POST /publishing/writers/:norm/map',
  'publishing-terms': 'POST /publishing/terms',
  'create-split': 'POST /splits',
  'recreate-participation': 'POST /participations/:id/close',
  'set-rule': 'POST /labels/:id/rules',
  'close-rule': 'POST /labels/rules/:id/close',
  'add-note': 'PATCH /tracks/:id',
  'edit-note': 'PATCH /tracks/:id',
  'clear-note': 'PATCH /tracks/:id',
  'set-label': 'PATCH /settlements/operations/:id',
  'set-payer': 'PATCH /ads/:id',
  'track-labels': 'POST /tracks/:isrc/label',
} as const satisfies Record<string, OperationKey>;

export type RowAction = keyof typeof ACTION_OPS;
