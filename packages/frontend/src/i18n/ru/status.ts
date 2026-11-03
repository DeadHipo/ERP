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
  fileStatus: {
    loading: 'загружается',
    loaded: 'загружен',
    failed: 'ошибка',
    superseded: 'заменён',
  },
  payoutGate: {
    owner_not_confirmed: 'владелец не подтверждён',
    payout_blocked: 'есть выплата без подтверждения',
    nothing_to_pay: 'нечего выплачивать',
    below_threshold: 'ниже порога',
  },
} as const;
