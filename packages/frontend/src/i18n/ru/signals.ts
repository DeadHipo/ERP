import type { signalsSchema } from '@erp/shared/api-responses';

/** Russian label of every signal list (a key of `signalsSchema`); the compiler refuses a missing key. */
export const signals = {
  unallocated: 'Не распределено (пары вне каталога, строки без ISRC)',
  isrcsWithoutSplit: 'ISRC без сплита',
  ambiguousWriters: 'Неоднозначные авторы',
  unfunded: 'Вырезы больше своей корзины',
  labelUnmapped: 'Строки лейбла без сопоставления',
  sublabelWithoutRule: 'Сублейблы без правила',
  ruleRecipientIsRow: 'Получатель правила также в строках сплита',
  twoRowsOneOwner: 'Две строки одного владельца',
  tracksWithNote: 'Треки с заметкой',
  participantsWithoutOwner: 'Участники без владельца',
  assumptions: 'Допущения',
  operationsWithoutLabel: 'Операции без лейбла',
  labelOutsideAccount: 'Строки лейбла вне своего счёта',
} as const satisfies Record<Exclude<keyof typeof signalsSchema.shape, 'counts'>, string>;
