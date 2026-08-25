// Карта талантов (Фаза 5a) — карта 9-box: чистая логика без AI. Строки —
// ось Y (KPI, вручную), столбцы — ось X (индекс соответствия, Фаза 4),
// обе на той же трёхзначной шкале «не соответствует / соответствует /
// превосходит» (src/talentCompliance.js).

import {
  TALENT_BAND_BELOW, TALENT_BAND_MATCH, TALENT_BAND_EXCEEDS, computeBand, DEFAULT_BAND_THRESHOLDS,
} from './talentCompliance';

// Сверху вниз и слева направо — как задано в спецификации Фазы 5a.
export const Y_AXIS_ORDER = [TALENT_BAND_EXCEEDS, TALENT_BAND_MATCH, TALENT_BAND_BELOW];
export const X_AXIS_ORDER = [TALENT_BAND_BELOW, TALENT_BAND_MATCH, TALENT_BAND_EXCEEDS];

export const POOL_NONE = 'none';
export const POOL_RESERVE1 = 'reserve1';
export const POOL_RESERVE2 = 'reserve2';
export const POOL_WATCHLIST = 'watchlist';
export const POOL_REDZONE = 'redzone';

// Порядок фиксирован — используется и для выпадающих списков в редакторе
// ячеек, и для перечисления пулов на странице.
export const POOL_ORDER = [POOL_RESERVE1, POOL_RESERVE2, POOL_WATCHLIST, POOL_REDZONE];

export const POOL_LABELS = {
  [POOL_NONE]: 'нет',
  [POOL_RESERVE1]: 'Резерв 1 (руководящий)',
  [POOL_RESERVE2]: 'Резерв 2 (экспертный)',
  [POOL_WATCHLIST]: 'Список наблюдения',
  [POOL_REDZONE]: 'Красная зона',
};

export const ZONE_OPTIONS = ['green', 'yellow', 'red'];
export const ZONE_LABELS = { green: 'Зелёная', yellow: 'Жёлтая', red: 'Красная' };

// Та же палитра, что TALENT_BAND_STYLE в talentCompliance.js (не общий
// импорт — зона квадранта и полоса оценки концептуально разные вещи,
// совпадение цветов чисто визуальное).
export const ZONE_STYLE = {
  green: { bg: 'rgba(91, 140, 110, 0.14)', border: 'rgba(91, 140, 110, 0.4)', text: 'var(--color-success)' },
  yellow: { bg: 'rgba(226, 145, 71, 0.14)', border: 'rgba(226, 145, 71, 0.45)', text: 'var(--color-accent-hover)' },
  red: { bg: '#FCE8E6', border: 'rgba(180, 35, 24, 0.35)', text: '#B42318' },
};

export function quadrantKey(yBand, xBand) {
  return `${yBand}_${xBand}`;
}

// Значения по умолчанию для всех 9 ячеек — ровно как заданы в тексте
// задачи Фазы 5a. Редактируются суперадмином (TalentMapQuadrantEditor.jsx)
// и хранятся как overrides в talentMaps/{ownerUid}.quadrants; getQuadrant()
// ниже сливает override поверх дефолта.
export const DEFAULT_QUADRANTS = {
  [quadrantKey(TALENT_BAND_EXCEEDS, TALENT_BAND_EXCEEDS)]: {
    name: 'Высокий лидерский потенциал',
    zone: 'green',
    pool: POOL_RESERVE1,
    action: 'Ускоренное продвижение, ротации, программы развития лидерства, приоритет в наставничестве',
  },
  [quadrantKey(TALENT_BAND_EXCEEDS, TALENT_BAND_MATCH)]: {
    name: 'Профессионал',
    zone: 'green',
    pool: POOL_RESERVE2,
    action: 'Удержание, развитие вглубь экспертизы, роль наставника',
  },
  [quadrantKey(TALENT_BAND_EXCEEDS, TALENT_BAND_BELOW)]: {
    name: 'Результативный',
    zone: 'yellow',
    pool: POOL_NONE,
    action: 'Сильный результат — развивать компетенции до уровня грейда',
  },
  [quadrantKey(TALENT_BAND_MATCH, TALENT_BAND_EXCEEDS)]: {
    name: 'Высокий потенциал',
    zone: 'green',
    pool: POOL_RESERVE1,
    action: 'Расширить, раскрыть, вознаградить и удержать',
  },
  [quadrantKey(TALENT_BAND_MATCH, TALENT_BAND_MATCH)]: {
    name: 'Устойчивый результат',
    zone: 'green',
    pool: POOL_WATCHLIST,
    action: 'Крепкое ядро; кандидат в резерв при подтверждении роста через 1–2 цикла',
  },
  [quadrantKey(TALENT_BAND_MATCH, TALENT_BAND_BELOW)]: {
    name: 'Обратить внимание',
    zone: 'yellow',
    pool: POOL_NONE,
    action: 'Разобраться в причине (роль, новизна, ресурсы); не готовить к увольнению; пересмотр 3–6 мес',
  },
  [quadrantKey(TALENT_BAND_BELOW, TALENT_BAND_EXCEEDS)]: {
    name: 'Нераскрытый потенциал',
    zone: 'yellow',
    pool: POOL_NONE,
    action: 'Сменить команду/задачи; краткосрочный план роста результата; пересмотр 3–6 мес',
  },
  [quadrantKey(TALENT_BAND_BELOW, TALENT_BAND_MATCH)]: {
    name: 'Постепенный рост',
    zone: 'yellow',
    pool: POOL_RESERVE2,
    action: 'План развития результата; наблюдение',
  },
  [quadrantKey(TALENT_BAND_BELOW, TALENT_BAND_BELOW)]: {
    name: 'Проблема',
    zone: 'red',
    pool: POOL_REDZONE,
    action: 'Письменный план с измеримыми условиями; точки сверки с руководителем и HR; пересмотр через 3 месяца',
  },
};

// quadrants — overrides из talentMaps/{ownerUid}.quadrants (может быть {}
// или частично не содержать ключ) — там, где override нет, берётся дефолт.
export function getQuadrant(quadrants, yBand, xBand) {
  const key = quadrantKey(yBand, xBand);
  return (quadrants && quadrants[key]) || DEFAULT_QUADRANTS[key];
}

// Эффективная полоса Y: если задан KPI% — считается по тем же
// настраиваемым порогам, что и ось X (thresholds приходит от вызывающего
// кода, обычно bandThresholds из talentMaps); если KPI% не задан — берётся
// вручную выбранная полоса. Пусто/не задано — null (сотрудник ещё не
// размещается на карте).
export function computeEffectiveYBand(yAssessment, thresholds = DEFAULT_BAND_THRESHOLDS) {
  if (!yAssessment) return null;
  const { kpiPercent, manualBand } = yAssessment;
  if (kpiPercent !== null && kpiPercent !== undefined && kpiPercent !== '') {
    const pct = Number(kpiPercent);
    if (!Number.isNaN(pct)) return computeBand(pct, thresholds);
  }
  return manualBand || null;
}

// Автоматический список кандидатов пула — все сотрудники, чья ячейка
// (по текущей конфигурации quadrants) отмечена этим уровнем пула. Ручные
// добавления/исключения накладываются отдельно в UI (TalentMapTalentPools.jsx),
// не здесь — эта функция всегда отражает только «что получилось по сетке».
export function computeAutoPoolMembers(poolKey, placement, quadrants) {
  return placement
    .filter(p => getQuadrant(quadrants, p.yBand, p.xBand).pool === poolKey)
    .map(p => p.evalueeId);
}

// Ориентир для калибровки (не квота) и порог «сильного перекоса» — оба
// зашиты как в тексте задачи Фазы 5a, не настраиваются интерфейсом.
export const BAND_DISTRIBUTION_BENCHMARK = {
  [TALENT_BAND_BELOW]: 20,
  [TALENT_BAND_MATCH]: 60,
  [TALENT_BAND_EXCEEDS]: 20,
};
export const DISTRIBUTION_SKEW_THRESHOLD = 40;

export function computeAxisDistribution(bands) {
  const total = bands.length;
  const counts = { [TALENT_BAND_BELOW]: 0, [TALENT_BAND_MATCH]: 0, [TALENT_BAND_EXCEEDS]: 0 };
  bands.forEach(b => { if (counts[b] !== undefined) counts[b]++; });
  const pct = {};
  Object.keys(counts).forEach(k => {
    pct[k] = total > 0 ? Math.round((counts[k] / total) * 100) : 0;
  });
  const skewed = Object.keys(counts).filter(k => pct[k] > DISTRIBUTION_SKEW_THRESHOLD);
  return { total, counts, pct, skewed };
}
