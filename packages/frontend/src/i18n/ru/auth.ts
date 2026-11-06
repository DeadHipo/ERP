/** P23 «Вход» (D-170): the login page, outside the shell. */
export const auth = {
  title: 'Вход',
  subtitle: 'Войдите, чтобы работать с данными своей организации',
  login: 'Логин',
  password: 'Пароль',
  submit: 'Войти',
  checking: 'Проверяем сессию…',
  chooseOrg: 'Вы работаете в нескольких организациях: выберите, в какой войти',
  org: 'Организация',
  back: 'Назад',
  roles: { org_admin: 'администратор', label_manager: 'менеджер лейбла' },
} as const;
