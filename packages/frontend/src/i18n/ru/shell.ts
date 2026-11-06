export const shell = {
  operator: {
    label: 'Оператор',
    placeholder: 'Ваше имя',
    hint: 'укажите оператора',
    rowsHint: 'Укажите оператора в шапке: без него кнопки действий в строках недоступны.',
    help: 'Имя записывается в журнал каждой операции записи',
    required: 'Укажите оператора: имя пишется в журнал записей',
  },
  label: {
    label: 'Лейбл',
    all: 'Все',
    help: 'Под лейблом видны его артисты, деньги и операции; выплата делается под лейблом (D-168)',
    pick: 'выберите лейбл в шапке: запись делается под лейблом',
  },
  role: {
    /** A button whose operation is not in `me.abilities` (D-171). */
    closed: 'нет права',
  },
  support: {
    banner: 'поддержка до {until}',
    readOnly: 'только чтение',
    write: 'с записью',
  },
  user: {
    label: 'Пользователь',
    changePassword: 'Сменить пароль',
    changePasswordSubtitle: 'Другие сессии этого пользователя закончатся',
    currentPassword: 'Текущий пароль',
    newPassword: 'Новый пароль',
    passwordChanged: 'Пароль изменён',
    support: 'поддержка',
    logout: 'Выйти',
    systemAdmin: 'системный администратор',
    noOrg: 'организация не выбрана',
    leaveOrg: 'Выйти из организации',
  },
  recalc: 'идёт пересчёт',
  theme: { toDark: 'Тёмная тема', toLight: 'Светлая тема' },
  searchButton: 'Поиск',
  searchShortcut: 'Ctrl+K',
} as const;
