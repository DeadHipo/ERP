import type { CReason } from '@erp/shared/api-responses';

/** Russian label of every category C reason; the compiler refuses a missing key. */
export const reasons = {
  split_unconfirmed: 'строка сплита без утверждённого документа',
  rule_unconfirmed: 'правило (верхний слой, вырез, сублейбл) без утверждённого документа',
  assumption: 'допущение (решение без утверждённого документа)',
  artist_without_owner: 'у псевдонима нет владельца',
  owner_unconfirmed: 'владелец не подтверждён',
  label_unmapped: 'строка лейбла Believe не сопоставлена лейблу',
  no_split: 'ISRC без сплита: доля лейбла не распределена',
  unknown_pair: 'пара ISRC/UPC не в каталоге',
  no_isrc: 'строка без ISRC',
  publishing_terms_unconfirmed: 'условия паблишинга без утверждённого документа',
  writer_unmapped: 'автор не связан с владельцем',
} as const satisfies Record<CReason, string>;
