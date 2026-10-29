// Карта талантов — предварительный отчёт только по оси X (без KPI/оси Y).
// Чистая логика без UI и без обращений к Firestore: строки отчёта, положение
// внутри грейда и предварительные кандидаты в Резерв 1 (руководящий) и
// Резерв 2 (экспертный) по всем 7 компетенциям. Окончательные решения по
// резерву принимает комитет после появления оси Y (KPI).

import { TALENT_COMPETENCIES } from './talentCompetencies';
import { normalizeGrade } from './talentGrades';
import {
  TALENT_BAND_BELOW, getEffectiveBand, getAssessmentComplianceIndex, getAssessmentTargetScore,
  isCeilingGrade,
} from './talentCompliance';

export const RESERVE_1 = 'reserve1';
export const RESERVE_2 = 'reserve2';
export const RESERVE_LABELS = {
  [RESERVE_1]: 'Резерв 1 (руководящий)',
  [RESERVE_2]: 'Резерв 2 (экспертный)',
};

// Профили: какие компетенции показывают потенциал руководителя, а какие —
// эксперта. «Лояльность» не входит ни в один профиль, но участвует в общем
// балле (процентиль) и в проверке «ни одна компетенция не ниже минимума» —
// так в оценке резерва участвуют все 7 компетенций.
export const LEADERSHIP_PROFILE_IDS = ['strategy', 'leadership', 'team'];
export const EXPERT_PROFILE_IDS = ['result', 'analytics', 'client'];

export const POSITION_TOP = 'top';
export const POSITION_MIDDLE = 'middle';
export const POSITION_BOTTOM = 'bottom';
export const POSITION_LABELS = {
  [POSITION_TOP]: 'Верхние 20%',
  [POSITION_MIDDLE]: 'Середина 60%',
  [POSITION_BOTTOM]: 'Нижние 20%',
};

export const DEFAULT_RESERVE_RULES = {
  minPercentile: 70, // кандидат — не ниже этого процентиля среди своего грейда
  minProfileScore: 3.0, // профильный балл (среднее 3 компетенций) не ниже уровня 3
  minCompetencyScore: 2.0, // ни одна из 7 компетенций не ниже этого балла
};

const PROFILE_TIE_MARGIN = 0.15;

function mean(values) {
  const nums = values.filter(v => typeof v === 'number' && !Number.isNaN(v));
  return nums.length === values.length && nums.length > 0
    ? nums.reduce((a, b) => a + b, 0) / nums.length
    : null;
}

export function competencyName(id) {
  return TALENT_COMPETENCIES.find(c => c.id === id)?.name || id;
}

// pairs — те же пары «оцениваемый + руководитель», что строят другие шаги.
export function buildXReportRows({ pairs, gradeTargets, bandThresholds, finalAssessments }) {
  const rows = pairs.map(p => {
    const assessment = finalAssessments?.[p.evalueeId] || null;
    const grade = p.evaluee.grade || assessment?.grade || '';
    if (!assessment || assessment.overallAverage === null || assessment.overallAverage === undefined) {
      return {
        evalueeId: p.evalueeId, fio: p.evaluee.fio, grade, gradeKey: normalizeGrade(grade),
        managerFio: p.manager?.fio || '', assessed: false,
      };
    }
    const compAvgs = assessment.competencyAverages || {};
    return {
      evalueeId: p.evalueeId,
      fio: p.evaluee.fio,
      grade,
      gradeKey: normalizeGrade(grade),
      managerFio: p.manager?.fio || '',
      assessed: true,
      target: getAssessmentTargetScore(assessment, gradeTargets, grade),
      overallAverage: assessment.overallAverage,
      index: getAssessmentComplianceIndex(assessment, gradeTargets, grade),
      band: getEffectiveBand(assessment, gradeTargets, grade, bandThresholds),
      manualOverride: !!assessment.manualOverrideBand,
      compAvgs,
      leadershipScore: mean(LEADERSHIP_PROFILE_IDS.map(id => compAvgs[id])),
      expertScore: mean(EXPERT_PROFILE_IDS.map(id => compAvgs[id])),
      minComp: Math.min(...TALENT_COMPETENCIES.map(c => (typeof compAvgs[c.id] === 'number' ? compAvgs[c.id] : Infinity))),
    };
  });

  // Положение внутри грейда: место по среднему баллу и процентиль
  // (доля коллег по грейду строго ниже + половина совпадающих).
  const byGrade = new Map();
  rows.filter(r => r.assessed).forEach(r => {
    if (!byGrade.has(r.gradeKey)) byGrade.set(r.gradeKey, []);
    byGrade.get(r.gradeKey).push(r);
  });
  byGrade.forEach(list => {
    const n = list.length;
    list.forEach(r => {
      const lower = list.filter(x => x.overallAverage < r.overallAverage - 1e-9).length;
      const equal = list.filter(x => Math.abs(x.overallAverage - r.overallAverage) < 1e-9).length;
      const higher = list.filter(x => x.overallAverage > r.overallAverage + 1e-9).length;
      r.gradeRank = higher + 1;
      r.gradeCount = n;
      r.percentile = Math.round(((lower + 0.5 * equal) / n) * 100);
      r.position = r.percentile >= 80 ? POSITION_TOP : (r.percentile <= 20 ? POSITION_BOTTOM : POSITION_MIDDLE);
    });
  });

  return rows;
}

// Предварительный кандидат в резерв по правилам rules. Возвращает
// { pool, note, reasons }: pool — RESERVE_1 / RESERVE_2 / null; reasons —
// почему не кандидат (пусто, если кандидат).
export function evaluateReserveCandidate(row, gradeTargets, rules = DEFAULT_RESERVE_RULES) {
  if (!row.assessed) return { pool: null, note: '', reasons: ['нет итоговых баллов'] };

  const reasons = [];
  if (row.percentile < rules.minPercentile) reasons.push(`процентиль в грейде ${row.percentile} < ${rules.minPercentile}`);
  if (row.minComp < rules.minCompetencyScore) reasons.push(`есть компетенция ниже ${fmtNum(rules.minCompetencyScore)}`);

  const ceiling = isCeilingGrade(gradeTargets, row.target);
  if (!ceiling && row.band === TALENT_BAND_BELOW) reasons.push('полоса X «Не соответствует»');

  const leadOk = row.leadershipScore !== null && row.leadershipScore >= rules.minProfileScore;
  const expOk = row.expertScore !== null && row.expertScore >= rules.minProfileScore;
  if (!leadOk && !expOk) reasons.push(`ни один профиль не достиг ${fmtNum(rules.minProfileScore)}`);

  if (reasons.length > 0) return { pool: null, note: '', reasons };

  const pool = leadOk && (!expOk || row.leadershipScore >= row.expertScore) ? RESERVE_1 : RESERVE_2;
  const notes = [];
  if (leadOk && expOk && Math.abs(row.leadershipScore - row.expertScore) < PROFILE_TIE_MARGIN) {
    notes.push('подходит в оба резерва — обсудить');
  }
  if (ceiling) notes.push('грейд с потолком шкалы — решение комитета');
  return { pool, note: notes.join('; '), reasons: [] };
}

export function fmtNum(n, digits = 2) {
  return n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits).replace('.', ',');
}

export function sortGradeKeys(keys) {
  return [...keys].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
}
