/**
 * The open items of `docs/agents/15_mvp_report.md` §3 (the owner's decisions or documents; nothing here is a code gap)
 * and where the operator sees each (`16_frontend_jobs.md` §2.8). The page «Решения руководителя» (P3) lists them;
 * no names and no amounts here: the amounts are on the page the link opens. The ids are fixed: 15.3.1 … 15.3.14.
 * No imports: the browser bundle imports this file.
 */
export type OpenQuestionPlace = 'queue' | 'signal' | 'owners' | 'list';

export interface OpenQuestion {
  id: string;
  /** Short Russian title. */
  title: string;
  /** The decision entries (`docs/97`) the item waits on or is governed by; ⚠ ones wait for the product owner. */
  decisionIds: string[];
  place: OpenQuestionPlace;
  /** A route of the app (nav.ts or a queue reason / signal list). */
  link: string;
  /** One Russian sentence: what is open and what the operator sees. */
  note: string;
}

export const OPEN_QUESTIONS: readonly OpenQuestion[] = [
  {
    id: '15.3.1',
    title: 'Правообладатели B17 и владельцы-артисты',
    decisionIds: ['D-083'],
    place: 'queue',
    link: '/queue/owner_unconfirmed',
    note: 'Авторские деньги правообладателей ждут в C, пока их не подтвердят договором или не сольют с владельцем-артистом.',
  },
  {
    id: '15.3.2',
    title: 'Документы, которые должен владелец',
    decisionIds: [],
    place: 'queue',
    link: '/queue/split_unconfirmed',
    note: 'Строки сплитов и допущения без документа ждут в C, сгруппированные по владельцу.',
  },
  {
    id: '15.3.3',
    title: 'Неоднозначные псевдонимы',
    decisionIds: [],
    place: 'list',
    link: '/artists/duplicates',
    note: 'Один псевдоним у двух артистов: ISRC без сплита и незагруженные строки ждут решения, кто есть кто.',
  },
  {
    id: '15.3.4',
    title: 'Список импринтов',
    decisionIds: ['D-123'],
    place: 'queue',
    link: '/queue/assumption',
    note: 'Строки лейблов вне решения владельца несут правило половины под допущением: доля сублейбла ждёт в C.',
  },
  {
    id: '15.3.5',
    title: 'Пары вырезов из таблицы Main',
    decisionIds: ['D-123'],
    place: 'queue',
    link: '/queue/assumption',
    note: 'Участия под документами-допущениями ждут в C; группы без процента остаются удержаниями.',
  },
  {
    id: '15.3.6',
    title: 'Деньги сублейблов в C',
    decisionIds: ['D-123'],
    place: 'queue',
    link: '/queue/owner_unconfirmed',
    note: 'Получатели сублейблов без договора у владельца не подтверждены; часть ждёт как допущение.',
  },
  {
    id: '15.3.7',
    title: 'Выкупы',
    decisionIds: [],
    place: 'list',
    link: '/splits?status=unconfirmed',
    note: 'ISRC с долей только в инструменте выкупа, продавцы не из сплита, дата инструмента: сегодня это B или наше, не C. Действие: выкуп или изменение сплита с месяца инструмента на карточке трека (вкладка «Правила») или на странице сплитов.',
  },
  {
    id: '15.3.8',
    title: 'Обновлённая выписка B17 и правила паблишинга',
    decisionIds: ['D-041', 'D-087', 'D-045', 'D-096'],
    place: 'list',
    link: '/publishing',
    note: 'Повторная выписка за квартал отклоняется (загрузка на «Отчётах» — бэкенд отвечает duplicate_period), доли авторов поровну, выкупы паблишинга и компании-получатели ждут решения. Действие: условия паблишинга по владельцу и типу операции здесь; привязка автора к владельцу.',
  },
  {
    id: '15.3.9',
    title: 'Исключение по артистам одного лейбла',
    decisionIds: [],
    place: 'owners',
    link: '/labels',
    note: 'Исключение для отдельных артистов не выражается одним правилом лейбла; расхождения реестра владельца вне ERP. Действие: закрыть правило саблейбла здесь и завести сплит или участие по каждому ISRC на карточке трека.',
  },
  {
    id: '15.3.10',
    title: 'Необъяснённые балансы владельцев',
    decisionIds: [],
    place: 'owners',
    link: '/owners?view=payouts',
    note: 'Остатки, которые названные причины не объясняют, и деньги, которые лейбл должен артисту: список владельцев с к выплате.',
  },
  {
    id: '15.3.11',
    title: 'Деньги ISRC без сплита',
    decisionIds: ['D-029'],
    place: 'signal',
    link: '/signals/isrcsWithoutSplit',
    note: 'Нетто ISRC без сплита сегодня наше; руководитель говорит, какие из них чужой репертуар.',
  },
  {
    id: '15.3.12',
    title: 'Условия администрирования до их начала',
    decisionIds: ['D-043'],
    place: 'queue',
    link: '/queue/publishing_terms_unconfirmed',
    note: 'Кварталы до начала условий стоят на 50 % по умолчанию и ждут в C.',
  },
  {
    id: '15.3.13',
    title: 'Условия лицензиаров',
    decisionIds: ['D-123'],
    place: 'queue',
    link: '/queue/assumption',
    note: 'Строка лицензиара записана строкой сплита под допущением, а не перенаправлением; процент лицензии не сверен.',
  },
  {
    id: '15.3.14',
    title: 'Остаток после выкупа',
    decisionIds: ['D-138'],
    place: 'owners',
    link: '/operations',
    note: 'Пропорциональная часть доли выкупленной строки за два месяца считается нашей; руководитель подтверждает. Действие: если решит иначе — кредит владельцу (операция «вход») с документом-основанием здесь или изменение сплита с месяца на карточке трека.',
  },
];
