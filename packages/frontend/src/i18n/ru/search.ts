export const search = {
  title: 'Глобальный поиск',
  placeholder: 'Владелец, псевдоним, ISRC, UPC, название, документ, лейбл',
  hint: 'Введите минимум два символа',
  empty: 'Ничего не найдено',
  kinds: {
    owners: 'Владельцы',
    artists: 'Псевдонимы',
    tracks: 'Треки',
    documents: 'Документы',
    labels: 'Лейблы',
  },
  pickerPlaceholder: 'Начните вводить для поиска',
  pickerEmpty: 'Нет совпадений',
  pickerTooMany: 'Показаны первые совпадения: уточните запрос',
} as const;
