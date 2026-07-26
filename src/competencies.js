export const STANDARD_TRACK = 'standard';
export const TOP_TRACK = 'top';
export const DEFAULT_TRACK = STANDARD_TRACK;

export const TRACK_LABELS = {
  [STANDARD_TRACK]: 'Рядовой сотрудник',
  [TOP_TRACK]: 'Топ-менеджмент',
};

// Unchanged from the original single competency set. Existing feedback docs
// were written with these exact ids (1-6) in competencyScores — keep them
// as-is so past answers stay valid.
export const STANDARD_COMPETENCIES = [
  { id: 1, name: 'Коммуникация', question: 'Ясно выражает свои идеи и активно слушает других' },
  { id: 2, name: 'Командная работа', question: 'Поддерживает атмосферу в команде и помогает коллегам' },
  { id: 3, name: 'Управление временем', question: 'Планирует работу и соблюдает сроки' },
  { id: 4, name: 'Качество работы', question: 'Обращает внимание на детали и стремится к совершенству' },
  { id: 5, name: 'Инициатива и решение проблем', question: 'Проактивно предлагает идеи и решает проблемы' },
  { id: 6, name: 'Ответственность', question: 'Надежен и отвечает за результаты своей работы' },
];

// ids start at 101 so they can never collide with STANDARD_COMPETENCIES ids.
export const TOP_COMPETENCIES = [
  { id: 101, name: 'Стратегическое мышление', question: 'Видит картину целиком, мыслит на перспективу, учитывает рынок' },
  { id: 102, name: 'Лидерство и развитие команды', question: 'Вдохновляет, растит руководителей под собой, строит сильную команду' },
  { id: 103, name: 'Принятие решений в условиях неопределённости', question: 'Решает при неполных данных, берёт ответственность' },
  { id: 104, name: 'Управление изменениями', question: 'Инициирует изменения и ведёт людей через них' },
  { id: 105, name: 'Ориентация на результат', question: 'Доводит до бизнес-результата, расставляет приоритеты, управляет ресурсами' },
  { id: 106, name: 'Влияние и коммуникация', question: 'Убедительно доносит позицию, выстраивает отношения со стейкхолдерами' },
];

export function getCompetenciesForTrack(track) {
  return track === TOP_TRACK ? TOP_COMPETENCIES : STANDARD_COMPETENCIES;
}
