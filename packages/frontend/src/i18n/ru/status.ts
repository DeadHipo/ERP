import type { LabelSource, OperationKind } from '@erp/shared/operation-kinds';

export const status = {
  documentStatus: {
    not_attached: 'нет файла',
    not_approved: 'не утверждён',
    approved: 'утверждён',
    missing: 'нет документа',
  },
  documentKind: {
    contract: 'договор',
    appendix: 'приложение',
    buyout: 'выкуп',
    advance_basis: 'основание аванса',
    adjustment_basis: 'основание корректировки',
    payment_proof: 'подтверждение выплаты',
    return_proof: 'подтверждение возврата',
    other: 'другое',
    assumption: 'допущение',
    label_decision: 'решение лейбла',
  },
  ownerStatus: {
    confirmed: 'подтверждён',
    waiting_documents: 'ждёт документов',
  },
  artistStatus: {
    confirmed: 'подтверждён',
    unconfirmed: 'не подтверждён',
    no_owner: 'без владельца',
  },
  category: {
    B: 'B: чужие',
    C: 'C: ждут',
  },
  operationMeaning: {
    payout: 'выплата',
    recoupable_payout: 'аванс',
    deduction: 'удержание',
    credit: 'зачисление',
    return: 'возврат',
  },
  /** The stored kind of an operation (D-173, `@erp/shared/operation-kinds`). */
  operationKind: {
    payout: 'выплата',
    advance: 'аванс',
    deduction: 'удержание',
    credit: 'зачисление',
    return: 'возврат',
    buyout: 'выкуп',
    forgiveness: 'прощение',
    writeoff: 'списание',
    adjustment: 'корректировка',
  } satisfies Record<OperationKind, string>,
  /** Who set the label of an operation (D-173): `default` = put under 0to8 by default (D-168), revisited by the owner. */
  labelSource: {
    one: 'по юнитам',
    default: 'по умолчанию',
    operator: 'оператор',
    payout: 'по выплате',
  } satisfies Record<LabelSource, string>,
  fileStatus: {
    loading: 'загружается',
    loaded: 'загружен',
    failed: 'ошибка',
    superseded: 'заменён',
  },
  payoutGate: {
    owner_not_confirmed: 'владелец не подтверждён',
    no_contract_for_label: 'нет договора с этим лейблом',
    payout_blocked: 'есть выплата без подтверждения',
    nothing_to_pay: 'нечего выплачивать',
    below_threshold: 'ниже порога',
    hold: 'холд',
    no_payee: 'нет получателя',
    needs_answer: 'нужен ответ',
  },
} as const;
