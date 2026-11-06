export const common = {
  appName: 'ERP',
  loading: 'Загрузка…',
  retry: 'Повторить',
  cancel: 'Отмена',
  confirm: 'Подтвердить',
  close: 'Закрыть',
  save: 'Сохранить',
  create: 'Создать',
  search: 'Поиск',
  noData: 'нет данных',
  yes: 'да',
  no: 'нет',
  notFound: 'Страница не найдена',
  backHome: 'На главную',
  /** The severity of an import class (`IssueChips`: P28, P29). */
  severity: { error: 'ошибка', warning: 'предупреждение', info: 'сведения' },
  /** `ArtistLinks` (D-166): the pseudonyms of a catalog row; the report string when the registry names none. */
  artistLinks: {
    title: 'Артисты',
    notInRegistry: 'Нет в реестре: строка артиста из отчёта Believe, псевдоним не найден (сплит, участие или связь трек → артист)',
  },
} as const;
