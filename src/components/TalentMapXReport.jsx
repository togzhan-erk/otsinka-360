import React, { useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { TALENT_ASSIGNMENT_SELF, TALENT_ASSIGNMENT_MANAGER } from '../talentAssignments';
import {
  TALENT_BAND_LABELS, TALENT_BAND_STYLE, TALENT_BAND_BELOW, TALENT_BAND_MATCH, TALENT_BAND_EXCEEDS,
} from '../talentCompliance';
import { TALENT_COMPETENCIES } from '../talentCompetencies';
import {
  buildXReportRows, evaluateReserveCandidate, DEFAULT_RESERVE_RULES, RESERVE_1, RESERVE_2, RESERVE_LABELS,
  POSITION_LABELS, LEADERSHIP_PROFILE_IDS, EXPERT_PROFILE_IDS, competencyName, fmtNum, sortGradeKeys,
} from '../talentXReport';

const BANDS = [TALENT_BAND_EXCEEDS, TALENT_BAND_MATCH, TALENT_BAND_BELOW];
const PRELIMINARY_NOTE =
  'Предварительный отчёт: учтена только ось X (оценка компетенций после интервью). Ось Y (KPI за 2026 год) '
  + 'пока не учтена. Карта 9-box и окончательные решения по резерву — после защиты KPI и заседания комитета.';

// Те же пары «оцениваемый + руководитель», что строят остальные шаги модуля —
// продублированы намеренно, чтобы не трогать код прошлых фаз.
function buildPairs(employees, assignments) {
  const byEvaluee = new Map();
  assignments.forEach(a => {
    if (!byEvaluee.has(a.evalueeId)) byEvaluee.set(a.evalueeId, {});
    byEvaluee.get(a.evalueeId)[a.type] = a;
  });
  const getEmployee = (id) => employees.find(e => e.id === id);
  return [...byEvaluee.entries()]
    .filter(([, tasks]) => tasks[TALENT_ASSIGNMENT_MANAGER])
    .map(([evalueeId, tasks]) => {
      const managerTask = tasks[TALENT_ASSIGNMENT_MANAGER];
      return {
        evalueeId,
        evaluee: getEmployee(evalueeId),
        manager: getEmployee(managerTask.raterId),
        selfTask: tasks[TALENT_ASSIGNMENT_SELF],
        managerTask,
      };
    })
    .filter(p => p.evaluee && p.manager)
    .sort((a, b) => a.evaluee.fio.localeCompare(b.evaluee.fio, 'ru'));
}

const thStyle = {
  padding: '0.55rem 0.7rem', fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--color-text-muted)', textAlign: 'left', whiteSpace: 'nowrap',
};
const tdStyle = { padding: '0.5rem 0.7rem', verticalAlign: 'middle', fontSize: '0.85rem' };
const sectionTitle = { marginTop: '2.25rem', marginBottom: '0.6rem' };
const hint = { fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.9rem', lineHeight: 1.45 };

function BandBadge({ band }) {
  if (!band) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>;
  const style = TALENT_BAND_STYLE[band];
  return (
    <span style={{
      display: 'inline-flex', padding: '0.15rem 0.55rem', borderRadius: 999, fontSize: '0.75rem',
      fontWeight: 600, whiteSpace: 'nowrap', background: style.bg, color: style.color,
    }}>
      {TALENT_BAND_LABELS[band]}
    </span>
  );
}

function RuleInput({ label, value, step, onChange }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
      {label}
      <input
        className="input"
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        style={{ width: '120px', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
      />
    </label>
  );
}

function sortByAverage(a, b) {
  return b.overallAverage - a.overallAverage || a.fio.localeCompare(b.fio, 'ru');
}

// Раскрывающийся раздел «Предварительный отчёт по оси X» внутри шага
// «Карта талантов» (TalentMapNineBoxStep.jsx) — пока нет KPI (оси Y):
// итоги по грейдам, предварительная карта «грейд × полоса X», положение
// внутри грейда и кандидаты в Резерв 1/2 по всем 7 компетенциям. Только
// чтение: ничего не пишет в Firestore, не меняет оси и пулы.
function TalentMapXReport({ employees, assignments, gradeTargets, bandThresholds, finalAssessments }) {
  const reportRef = useRef(null);
  const [rules, setRules] = useState(DEFAULT_RESERVE_RULES);
  const [showAll, setShowAll] = useState(false);

  const safeRules = {
    minPercentile: Number.isFinite(rules.minPercentile) ? rules.minPercentile : DEFAULT_RESERVE_RULES.minPercentile,
    minProfileScore: Number.isFinite(rules.minProfileScore) ? rules.minProfileScore : DEFAULT_RESERVE_RULES.minProfileScore,
    minCompetencyScore: Number.isFinite(rules.minCompetencyScore) ? rules.minCompetencyScore : DEFAULT_RESERVE_RULES.minCompetencyScore,
  };

  const pairs = useMemo(() => buildPairs(employees, assignments), [employees, assignments]);
  const rows = useMemo(
    () => buildXReportRows({ pairs, gradeTargets, bandThresholds, finalAssessments }),
    [pairs, gradeTargets, bandThresholds, finalAssessments],
  );
  const assessed = rows.filter(r => r.assessed);
  const notAssessed = rows.filter(r => !r.assessed);

  const candidates = useMemo(() => {
    const map = new Map();
    assessed.forEach(r => map.set(r.evalueeId, evaluateReserveCandidate(r, gradeTargets, safeRules)));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessed, gradeTargets, rules]);

  const reserve1 = assessed.filter(r => candidates.get(r.evalueeId)?.pool === RESERVE_1).sort(sortByAverage);
  const reserve2 = assessed.filter(r => candidates.get(r.evalueeId)?.pool === RESERVE_2).sort(sortByAverage);

  const gradeKeys = sortGradeKeys([...new Set(assessed.map(r => r.gradeKey))]);
  const summary = gradeKeys.map(gk => {
    const list = assessed.filter(r => r.gradeKey === gk);
    const counts = { [TALENT_BAND_EXCEEDS]: 0, [TALENT_BAND_MATCH]: 0, [TALENT_BAND_BELOW]: 0 };
    list.forEach(r => { if (r.band) counts[r.band] += 1; });
    return {
      gradeKey: gk,
      label: list[0].grade || gk,
      target: list[0].target,
      n: list.length,
      avg: list.reduce((s, r) => s + r.overallAverage, 0) / list.length,
      counts,
    };
  });

  const handleDownloadExcel = () => {
    const wb = XLSX.utils.book_new();
    const sorted = [...assessed].sort((a, b) =>
      a.gradeKey.localeCompare(b.gradeKey, 'ru', { numeric: true }) || sortByAverage(a, b));

    const header1 = [
      'ФИО', 'Грейд', 'Руководитель', 'Целевой балл', 'Средний балл', 'ИС, %', 'Полоса X',
      'Место в грейде', 'Всего в грейде', 'Процентиль в грейде', 'Положение в грейде',
      ...TALENT_COMPETENCIES.map(c => c.name),
      'Лидерский профиль', 'Экспертный профиль', 'Предв. кандидат', 'Примечание',
    ];
    const body1 = sorted.map(r => {
      const c = candidates.get(r.evalueeId);
      return [
        r.fio, r.grade, r.managerFio, r.target, round2(r.overallAverage), r.index,
        r.band ? TALENT_BAND_LABELS[r.band] + (r.manualOverride ? ' (решение комитета)' : '') : '',
        r.gradeRank, r.gradeCount, r.percentile, POSITION_LABELS[r.position] || '',
        ...TALENT_COMPETENCIES.map(comp => round2(r.compAvgs?.[comp.id])),
        round2(r.leadershipScore), round2(r.expertScore),
        c?.pool ? RESERVE_LABELS[c.pool] : '',
        c?.pool ? c.note : (c?.reasons || []).join('; '),
      ];
    });
    const ws1 = XLSX.utils.aoa_to_sheet([header1, ...body1, ...notAssessed.map(r => [r.fio, r.grade, r.managerFio, '', 'нет итоговых баллов'])]);
    ws1['!cols'] = header1.map((h, i) => ({ wch: i === 0 ? 28 : (i === 2 ? 24 : Math.max(12, Math.min(22, h.length + 2))) }));
    XLSX.utils.book_append_sheet(wb, ws1, 'Итоги по оси X');

    // Сетка «грейд × полоса X»: один человек — одна строка, чтобы не зависеть
    // от переносов внутри ячейки.
    const gridRows = [['Предварительная карта (только ось X)'], [PRELIMINARY_NOTE], []];
    gradeKeys.forEach(gk => {
      const list = assessed.filter(r => r.gradeKey === gk).sort(sortByAverage);
      const cols = BANDS.map(b => list.filter(r => r.band === b).map(r => `${r.fio} (${fmtNum(r.overallAverage)})`));
      gridRows.push([`Грейд ${list[0].grade || gk}`, ...BANDS.map((b, i) => `${TALENT_BAND_LABELS[b]} — ${cols[i].length} чел.`)]);
      const max = Math.max(...cols.map(c => c.length), 0);
      for (let i = 0; i < max; i += 1) gridRows.push(['', ...cols.map(c => c[i] || '')]);
      gridRows.push([]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(gridRows);
    ws2['!cols'] = [{ wch: 14 }, { wch: 36 }, { wch: 36 }, { wch: 36 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Предв. карта');

    const resHeader = ['Пул', 'ФИО', 'Грейд', 'Руководитель', 'Средний балл', 'Процентиль в грейде',
      'Лидерский профиль', 'Экспертный профиль', 'Примечание'];
    const resBody = [];
    [[RESERVE_1, reserve1], [RESERVE_2, reserve2]].forEach(([pool, list]) => {
      list.forEach(r => resBody.push([
        RESERVE_LABELS[pool], r.fio, r.grade, r.managerFio, round2(r.overallAverage), r.percentile,
        round2(r.leadershipScore), round2(r.expertScore), candidates.get(r.evalueeId)?.note || '',
      ]));
    });
    const ws3 = XLSX.utils.aoa_to_sheet([
      ['Кандидаты на рассмотрение в резерв (предварительно, до появления оси Y)'], [PRELIMINARY_NOTE], [], resHeader, ...resBody,
    ]);
    ws3['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 9 }, { wch: 24 }, { wch: 13 }, { wch: 14 }, { wch: 15 }, { wch: 15 }, { wch: 44 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Кандидаты в резерв');

    const ws4 = XLSX.utils.aoa_to_sheet([
      ['Грейд', 'Целевой балл', 'Оценено, чел.', 'Средний балл', 'Превосходит', 'Соответствует', 'Не соответствует'],
      ...summary.map(s => [s.label, s.target, s.n, round2(s.avg), s.counts[TALENT_BAND_EXCEEDS], s.counts[TALENT_BAND_MATCH], s.counts[TALENT_BAND_BELOW]]),
    ]);
    ws4['!cols'] = [{ wch: 12 }, { wch: 13 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 17 }];
    XLSX.utils.book_append_sheet(wb, ws4, 'Сводка по грейдам');

    const method = [
      ['Методика предварительного отчёта'],
      [PRELIMINARY_NOTE],
      [],
      ['Положение в грейде: процентиль среднего балла среди коллег того же грейда (верхние 20% / середина 60% / нижние 20%).'],
      [`Лидерский профиль = среднее по компетенциям: ${LEADERSHIP_PROFILE_IDS.map(competencyName).join(', ')}.`],
      [`Экспертный профиль = среднее по компетенциям: ${EXPERT_PROFILE_IDS.map(competencyName).join(', ')}.`],
      ['Лояльность и остальные компетенции участвуют в общем среднем балле (процентиль) и в проверке минимума.'],
      [],
      ['Правила отбора кандидатов в резерв (настраиваются на экране отчёта):'],
      [`1. Процентиль в своём грейде не ниже ${safeRules.minPercentile}.`],
      [`2. Ни одна из 7 компетенций не ниже ${fmtNum(safeRules.minCompetencyScore, 1)}.`],
      [`3. Полоса X не «Не соответствует» (для грейда с потолком шкалы — решение комитета).`],
      [`4. Профильный балл не ниже ${fmtNum(safeRules.minProfileScore, 1)}: лидерский — Резерв 1, экспертный — Резерв 2; если подходят оба, берётся более сильный.`],
      [],
      ['Список — основание для обсуждения на калибровке, а не решение о включении в резерв.'],
    ];
    const ws5 = XLSX.utils.aoa_to_sheet(method);
    ws5['!cols'] = [{ wch: 130 }];
    XLSX.utils.book_append_sheet(wb, ws5, 'Методика');

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Итоги_оси_X_предварительно_${today}.xlsx`);
  };

  const handleDownloadPdf = async () => {
    const { default: html2canvas } = await import('html2canvas');
    const { default: jsPDF } = await import('jspdf');
    const el = reportRef.current;
    const canvas = await html2canvas(el, {
      scale: 2, useCORS: true, backgroundColor: '#F7F7F5', logging: false,
      ignoreElements: (element) => element.classList?.contains('report-no-pdf'),
    });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    let remaining = imgH;
    let yOffset = 0;
    pdf.addImage(imgData, 'PNG', 0, yOffset, imgW, imgH);
    remaining -= pageH;
    while (remaining > 0) {
      yOffset -= pageH;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, yOffset, imgW, imgH);
      remaining -= pageH;
    }
    pdf.save('Итоги_оси_X_предварительно.pdf');
  };

  if (pairs.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)' }}>
        Пар пока нет — они появляются для сотрудников, у которых в загруженном списке задан руководитель.
      </p>
    );
  }

  const reserveTable = (list) => (
    list.length === 0 ? (
      <p style={{ ...hint, marginBottom: 0 }}>Никого по текущим правилам.</p>
    ) : (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={thStyle}>ФИО</th><th style={thStyle}>Грейд</th><th style={thStyle}>Руководитель</th>
              <th style={thStyle}>Ср. балл</th><th style={thStyle}>Процентиль</th>
              <th style={thStyle}>Лидерский</th><th style={thStyle}>Экспертный</th><th style={thStyle}>Примечание</th>
            </tr>
          </thead>
          <tbody>
            {list.map(r => (
              <tr key={r.evalueeId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={tdStyle}>{r.fio}</td>
                <td style={tdStyle}>{r.grade}</td>
                <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{r.managerFio}</td>
                <td style={tdStyle}>{fmtNum(r.overallAverage)}</td>
                <td style={tdStyle}>{r.percentile}</td>
                <td style={tdStyle}>{fmtNum(r.leadershipScore)}</td>
                <td style={tdStyle}>{fmtNum(r.expertScore)}</td>
                <td style={{ ...tdStyle, color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>{candidates.get(r.evalueeId)?.note || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  return (
    <div>
      <div ref={reportRef}>
        <div style={{
          padding: '0.9rem 1.1rem', border: '1px solid rgba(232, 163, 61, 0.45)', background: 'rgba(232, 163, 61, 0.12)',
          borderRadius: 'var(--radius-card)', fontSize: '0.88rem', lineHeight: 1.5, marginBottom: '1.5rem',
        }}>
          {PRELIMINARY_NOTE}
        </div>

        <div className="report-no-pdf" style={{ marginBottom: '1.75rem' }}>
          <h4 style={{ marginBottom: '0.5rem' }}>Правила отбора в резерв</h4>
          <p style={hint}>
            Кандидат должен войти в верхние слои своего грейда, не иметь провальных компетенций и показать уровень 3 в одном из профилей.
            Лидерский профиль: {LEADERSHIP_PROFILE_IDS.map(competencyName).join(', ')}. Экспертный: {EXPERT_PROFILE_IDS.map(competencyName).join(', ')}.
            Лояльность и остальные компетенции учитываются в общем балле и в проверке минимума.
          </p>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
            <RuleInput label="Мин. процентиль в грейде" value={rules.minPercentile} step={5}
              onChange={(v) => setRules(prev => ({ ...prev, minPercentile: v }))} />
            <RuleInput label="Мин. профильный балл" value={rules.minProfileScore} step={0.1}
              onChange={(v) => setRules(prev => ({ ...prev, minProfileScore: v }))} />
            <RuleInput label="Мин. балл любой компетенции" value={rules.minCompetencyScore} step={0.1}
              onChange={(v) => setRules(prev => ({ ...prev, minCompetencyScore: v }))} />
          </div>
        </div>

        <h4 style={{ marginBottom: '0.5rem' }}>Итоги по грейдам</h4>
        <p style={hint}>
          Полоса «Превосходит / Соответствует / Не соответствует» считается от целевого балла грейда, поэтому различается по грейдам.
          Для сравнения людей внутри грейда используйте положение в грейде.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                <th style={thStyle}>Грейд</th><th style={thStyle}>Целевой балл</th><th style={thStyle}>Оценено</th>
                <th style={thStyle}>Средний балл</th><th style={thStyle}>Превосходит</th>
                <th style={thStyle}>Соответствует</th><th style={thStyle}>Не соответствует</th>
              </tr>
            </thead>
            <tbody>
              {summary.map(s => (
                <tr key={s.gradeKey} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{s.label}</td>
                  <td style={tdStyle}>{fmtNum(s.target)}</td>
                  <td style={tdStyle}>{s.n}</td>
                  <td style={tdStyle}>{fmtNum(s.avg)}</td>
                  <td style={tdStyle}>{s.counts[TALENT_BAND_EXCEEDS]}</td>
                  <td style={tdStyle}>{s.counts[TALENT_BAND_MATCH]}</td>
                  <td style={tdStyle}>{s.counts[TALENT_BAND_BELOW]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 style={sectionTitle}>Предварительная карта (только ось X)</h4>
        <p style={hint}>Внутри клетки люди расположены по убыванию среднего балла (в скобках).</p>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '90px repeat(3, minmax(190px, 1fr))', gap: '0.5rem', minWidth: '720px' }}>
            <div />
            {BANDS.map(b => (
              <div key={b} style={{ textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, color: TALENT_BAND_STYLE[b].color }}>
                {TALENT_BAND_LABELS[b]}
              </div>
            ))}
            {gradeKeys.map(gk => {
              const list = assessed.filter(r => r.gradeKey === gk).sort(sortByAverage);
              return (
                <React.Fragment key={gk}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', fontSize: '0.82rem', fontWeight: 700, paddingTop: '0.6rem' }}>
                    {list[0].grade || gk}
                  </div>
                  {BANDS.map(b => {
                    const cell = list.filter(r => r.band === b);
                    return (
                      <div key={b} style={{
                        border: `1px solid var(--color-border)`, borderRadius: 'var(--radius-card)',
                        background: TALENT_BAND_STYLE[b].bg, padding: '0.6rem 0.7rem', minHeight: '56px',
                      }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: TALENT_BAND_STYLE[b].color, marginBottom: '0.25rem' }}>
                          {cell.length} чел.
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.78rem' }}>
                          {cell.map(r => <li key={r.evalueeId}>{r.fio} ({fmtNum(r.overallAverage)})</li>)}
                        </ul>
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <h4 style={sectionTitle}>{RESERVE_LABELS[RESERVE_1]} — кандидаты на рассмотрение ({reserve1.length})</h4>
        <p style={hint}>
          Критерии: процентиль в грейде не ниже {safeRules.minPercentile}; профильный балл не ниже {fmtNum(safeRules.minProfileScore, 1)};
          ни одна из 7 компетенций не ниже {fmtNum(safeRules.minCompetencyScore, 1)}. Сильнее выражен лидерский профиль.
          Это основание для обсуждения на калибровке, а не решение о включении в резерв.
        </p>
        {reserveTable(reserve1)}

        <h4 style={sectionTitle}>{RESERVE_LABELS[RESERVE_2]} — кандидаты на рассмотрение ({reserve2.length})</h4>
        <p style={hint}>Сильнее выражен экспертный профиль.</p>
        {reserveTable(reserve2)}

        {notAssessed.length > 0 && (
          <div className="report-no-pdf" style={{ marginTop: '2rem' }}>
            <h5 style={{ marginBottom: '0.4rem' }}>Без итоговых баллов ({notAssessed.length})</h5>
            <p style={{ ...hint, marginBottom: 0 }}>
              {notAssessed.map(r => `${r.fio} (${r.grade || 'грейд не задан'})`).join(', ')}
            </p>
          </div>
        )}
      </div>

      <div className="report-no-pdf" style={{ marginTop: '2.25rem' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Скрыть полную таблицу' : 'Показать полную таблицу по людям'}
        </button>
        {showAll && (
          <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                  <th style={thStyle}>ФИО</th><th style={thStyle}>Грейд</th><th style={thStyle}>Ср. балл</th>
                  <th style={thStyle}>ИС%</th><th style={thStyle}>Полоса X</th><th style={thStyle}>Место</th>
                  <th style={thStyle}>Положение</th>
                  {TALENT_COMPETENCIES.map(c => <th key={c.id} style={thStyle}>{c.name}</th>)}
                  <th style={thStyle}>Кандидат</th>
                </tr>
              </thead>
              <tbody>
                {[...assessed]
                  .sort((a, b) => a.gradeKey.localeCompare(b.gradeKey, 'ru', { numeric: true }) || sortByAverage(a, b))
                  .map(r => (
                    <tr key={r.evalueeId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={tdStyle}>{r.fio}</td>
                      <td style={tdStyle}>{r.grade}</td>
                      <td style={tdStyle}>{fmtNum(r.overallAverage)}</td>
                      <td style={tdStyle}>{r.index !== null && r.index !== undefined ? `${r.index}%` : '—'}</td>
                      <td style={tdStyle}><BandBadge band={r.band} /></td>
                      <td style={tdStyle}>{r.gradeRank} из {r.gradeCount}</td>
                      <td style={tdStyle}>{POSITION_LABELS[r.position]}</td>
                      {TALENT_COMPETENCIES.map(c => <td key={c.id} style={tdStyle}>{fmtNum(r.compAvgs?.[c.id])}</td>)}
                      <td style={tdStyle}>{candidates.get(r.evalueeId)?.pool ? RESERVE_LABELS[candidates.get(r.evalueeId).pool] : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="report-no-pdf" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.75rem' }}>
        <button className="btn btn-secondary" onClick={handleDownloadExcel}>
          <FileSpreadsheet size={16} strokeWidth={2} />
          Скачать отчёт по оси X (Excel)
        </button>
        <button className="btn btn-accent" onClick={handleDownloadPdf}>
          <Download size={16} strokeWidth={2} />
          Скачать отчёт по оси X (PDF)
        </button>
      </div>
    </div>
  );
}

function round2(v) {
  return typeof v === 'number' && !Number.isNaN(v) ? Math.round(v * 100) / 100 : '';
}

export default TalentMapXReport;
