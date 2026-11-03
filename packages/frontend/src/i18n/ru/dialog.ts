export const dialog = {
  operator: 'Оператор',
  whatChanges: 'Что изменится',
  confirm: 'Подтвердить',
  cancel: 'Отмена',
  irreversible: 'необратимо',
  /** «совпало по» of the duplicate dialog: the `matchedBy` values of 409 `possible_duplicate`. */
  matchedBy: { name: 'имени', alias: 'варианту имени', 'name words': 'словам имени', pseudonym: 'псевдониму' } as Record<string, string>,
} as const;
