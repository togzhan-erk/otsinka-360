// Карта талантов (Фаза 4) — детерминированный расчёт индекса соответствия
// и полосы по оси X. Никакого AI: чистая арифметика над финальными
// (согласованными на интервью) баллами, таблицей целевых баллов по грейдам
// и настраиваемыми порогами коридора «Соответствует» (оба редактируются
// рядом друг с другом в TalentMapUploadStep.jsx, хранятся в
// talentMaps/{ownerUid} полями gradeTargets и bandThresholds).

import { TALENT_COMPETENCIES } from './talentCompetencies';

export const TALENT_BAND_BELOW = 'below';
export const TALENT_BAND_MATCH = 'match';
export const TALENT_BAND_EXCEEDS = 'exceeds';

export const TALENT_BAND_LABELS = {
  [TALENT_BAND_BELOW]: 'Не соответствует',
  [TALENT_BAND_MATCH]: 'Соответствует',
  [TALENT_BAND_EXCEEDS]: 'Превосходит',
};

// Пороги индекса соответствия (в процентах), настраиваемые суперадмином
// рядом с таблицей целевых баллов (TalentMapUploadStep.jsx) и хранимые в
// talentMaps/{ownerUid}.bandThresholds. Дефолт — методика по умолчанию
// (90/110); используется, пока суперадмин не сохранил свои значения или
// если сохранённые значения почему-то невалидны (isValidBandThresholds).
export const DEFAULT_BAND_THRESHOLDS = { lower: 90, upper: 110 };
export const BAND_THRESHOLD_MIN = 50;
export const BAND_THRESHOLD_MAX = 150;

export function isValidBandThresholds(thresholds) {
  if (!thresholds || typeof thresholds !== 'object') return false;
  const { lower, upper } = thresholds;
  if (typeof lower !== 'number' || typeof upper !== 'number') return false;
  if (Number.isNaN(lower) || Number.isNaN(upper)) return false;
  if (lower < BAND_THRESHOLD_MIN || lower > BAND_THRESHOLD_MAX) return false;
  if (upper < BAND_THRESHOLD_MIN || upper > BAND_THRESHOLD_MAX) return false;
  return lower < upper;
}

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
// 3.93) — формула индекса соответствия почти никогда не даёт «Превосходит»
// для него (средний балл выше 4 невозможен при шкале 1–4), поэтому такой
// переход — решение калибровочного комитета, а не арифметики. Настраиваемые
// пороги (см. ниже) на это правило не влияют — оно завязано на потолок
// шкалы 1–4, а не на конкретные проценты коридора.
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

// thresholds — {lower, upper} в процентах; по умолчанию DEFAULT_BAND_THRESHOLDS
// (90/110), пока суперадмин не настроит свои значения. Границы включены в
// «Соответствует» с обеих сторон (lower <= ИС <= upper).
export function computeBand(complianceIndexPct, thresholds = DEFAULT_BAND_THRESHOLDS) {
  if (complianceIndexPct === null || complianceIndexPct === undefined) return null;
  const { lower, upper } = isValidBandThresholds(thresholds) ? thresholds : DEFAULT_BAND_THRESHOLDS;
  if (complianceIndexPct < lower) return TALENT_BAND_BELOW;
  if (complianceIndexPct <= upper) return TALENT_BAND_MATCH;
  return TALENT_BAND_EXCEEDS;
}

// Ручное переопределение (решение калибровочного комитета) побеждает
// расчётную полосу. Полоса пересчитывается динамически из уже сохранённого
// complianceIndex и ТЕКУЩИХ порогов — не читается напрямую из assessment.band
// (который зафиксирован на момент последнего сохранения баллов), поэтому
// изменение порогов сразу отражается на всех ранее внесённых финальных
// баллах, без необходимости пересохранять их. Используется и здесь для
// отображения, и Фазой 5 при сборке карты 9-box (ось X приходит уже готовой
// отсюда).
export function getEffectiveBand(assessment, thresholds = DEFAULT_BAND_THRESHOLDS) {
  if (!assessment) return null;
  if (assessment.manualOverrideBand) return assessment.manualOverrideBand;
  return computeBand(assessment.complianceIndex, thresholds);
}
