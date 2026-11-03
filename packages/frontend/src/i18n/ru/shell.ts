export const shell = {
  operator: {
    label: 'Оператор',
    placeholder: 'Ваше имя',
    hint: 'укажите оператора',
    help: 'Имя записывается в журнал каждой операции записи',
    required: 'Укажите оператора: имя пишется в журнал записей',
  },
  recalc: 'идёт пересчёт',
  theme: { toDark: 'Тёмная тема', toLight: 'Светлая тема' },
  searchButton: 'Поиск',
  searchShortcut: 'Ctrl+K',
  pageInProgress: (step: string) => `Страница в разработке (шаг ${step})`,
  legacyLink: 'Старые страницы',
} as const;
