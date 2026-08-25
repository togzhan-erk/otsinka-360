// Карта талантов (Фаза 4) — детерминированный расчёт индекса соответствия
// и полосы по оси X. Никакого AI: чистая арифметика над финальными
// (согласованными на интервью) баллами и таблицей целевых баллов по
// грейдам (src/talentGrades.js: DEFAULT_GRADE_TARGETS / редактируемая
// таблица из TalentMapUploadStep.jsx).

import { TALENT_COMPETENCIES } from './talentCompetencies';

export const TALENT_BAND_BELOW = 'below';
export const TALENT_BAND_MATCH = 'match';
export const TALENT_BAND_EXCEEDS = 'exceeds';

export const TALENT_BAND_LABELS = {
  [TALENT_BAND_BELOW]: 'Не соответствует',
  [TALENT_BAND_MATCH]: 'Соответствует',
  [TALENT_BAND_EXCEEDS]: 'Превышает',
};

// Тот же формат {color, bg}, что STATUS_STYLE в TalentMapProgressStep.jsx
// и других местах модуля — не общий импорт (три статус-палитры лежат в
// своих файлах по сложившейся в проекте практике), просто согласованный
// внешний вид.
export const TALENT_BAND_STYLE = {
  [TALENT_BAND_BELOW]: { color: '#B42318', bg: '#FCE8E6' },
  [TALENT_BAND_MATCH]: { color: 'var(--color-success)', bg: 'rgba(91, 140, 110, 0.14)' },
  [TALENT_BAND_EXCEEDS]: { color: 'var(--color-accent-hover)', bg: 'rgba(226, 145, 71, 0.18)' },
};

// Балл по компетенции = среднее её 4 индикаторов; если хотя бы одного не
// хватает в scores, для этой компетенции возвращается null (частично
// заполненная форма не должна выдавать вводящее в заблуждение число).
export function computeCompetencyAverages(scores) {
  const result = {};
  TALENT_COMPETENCIES.forEach(comp => {
    const values = comp.indicators
      .map(ind => scores?.[ind.id])
      .filter(v => typeof v === 'number' && !Number.isNaN(v));
    result[comp.id] = values.length === comp.indicators.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
  });
  return result;
}

// Общий средний балл = среднее по 7 компетенциям (не по 28 индикаторам
// напрямую — так задано методикой; при полном заполнении формы результат
// математически совпадает, но так явно соответствует формулировке задачи).
export function computeOverallAverage(competencyAverages) {
  const values = Object.values(competencyAverages || {}).filter(v => typeof v === 'number' && !Number.isNaN(v));
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function getGradeTarget(gradeTargets, grade) {
  if (!grade) return null;
  const entry = (gradeTargets || []).find(g => g.grade === grade);
  return entry ? entry.target : null;
}

export function getMaxGradeTarget(gradeTargets) {
  if (!gradeTargets || gradeTargets.length === 0) return null;
  return Math.max(...gradeTargets.map(g => g.target));
}

// Грейд с максимальным целевым баллом в таблице (по умолчанию СЕО-1 →
// 3.93) — формула индекса соответствия почти никогда не даёт «Превышает»
// для него (средний балл выше 4 невозможен при шкале 1–4), поэтому такой
// переход — решение калибровочного комитета, а не арифметики.
export function isCeilingGrade(gradeTargets, targetScore) {
  const max = getMaxGradeTarget(gradeTargets);
  return targetScore !== null && targetScore !== undefined && max !== null && targetScore === max;
}

// ИС = (общий средний балл / целевой балл грейда) × 100%, округлено до
// целого процента. null, если средний балл или целевой балл ещё не
// определены (форма не заполнена / грейду не назначен целевой балл).
export function computeComplianceIndex(overallAverage, targetScore) {
  if (overallAverage === null || overallAverage === undefined) return null;
  if (!targetScore) return null;
  return Math.round((overallAverage / targetScore) * 100);
}

export function computeBand(complianceIndexPct) {
  if (complianceIndexPct === null || complianceIndexPct === undefined) return null;
  if (complianceIndexPct < 90) return TALENT_BAND_BELOW;
  if (complianceIndexPct <= 110) return TALENT_BAND_MATCH;
  return TALENT_BAND_EXCEEDS;
}

// Ручное переопределение (решение калибровочного комитета) побеждает
// расчётную полосу — используется и здесь для отображения, и Фазой 5 при
// сборке карты 9-box (ось X приходит уже готовой отсюда).
export function getEffectiveBand(assessment) {
  if (!assessment) return null;
  return assessment.manualOverrideBand || assessment.band || null;
}
