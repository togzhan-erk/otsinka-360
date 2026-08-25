import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { TALENT_ASSIGNMENT_SELF, TALENT_ASSIGNMENT_MANAGER } from '../talentAssignments';
import { getGradeTarget, getEffectiveBand, TALENT_BAND_LABELS, TALENT_BAND_STYLE } from '../talentCompliance';
import TalentMapFinalScoreForm from './TalentMapFinalScoreForm';

// Тот же способ построить пары «оцениваемый + его руководитель» из
// сохранённых assignments, что TalentMapPairReportsStep.jsx (Фаза 3)
// использует внутри себя — продублирован намеренно, а не вынесен в общий
// модуль, чтобы не трогать код прошлой фазы.
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
      const selfTask = tasks[TALENT_ASSIGNMENT_SELF];
      const managerTask = tasks[TALENT_ASSIGNMENT_MANAGER];
      const evaluee = getEmployee(evalueeId);
      const manager = getEmployee(managerTask.raterId);
      return {
        evalueeId,
        evaluee,
        manager,
        selfTask,
        managerTask,
        ready: selfTask?.status === 'completed' && managerTask?.status === 'completed',
      };
    })
    .filter(p => p.evaluee && p.manager)
    .sort((a, b) => a.evaluee.fio.localeCompare(b.evaluee.fio, 'ru'));
}

function fmt(n) {
  return n !== null && n !== undefined ? n.toFixed(2).replace('.', ',') : '—';
}

function BandBadge({ band }) {
  if (!band) return <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>—</span>;
  const style = TALENT_BAND_STYLE[band];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '0.2rem 0.65rem', borderRadius: 999,
      fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', background: style.bg, color: style.color,
    }}>
      {TALENT_BAND_LABELS[band]}
    </span>
  );
}

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
  color: 'var(--color-text-muted)', textAlign: 'left',
};
const tdStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'middle', fontSize: '0.88rem' };

// Шаг «Согласованные баллы» — список оцениваемых (те же пары, что и в
// «Отчёты по парам») плюс сводная таблица грейд/целевой балл/средний
// балл/ИС%/полоса X, и переключение на форму ввода для одного сотрудника.
// Расчёт (src/talentCompliance.js) полностью детерминированный — это не
// AI-функция.
function TalentMapFinalScoresStep({ employees, assignments, gradeTargets, bandThresholds, finalAssessments, onSaveFinalAssessment }) {
  const [openPair, setOpenPair] = useState(null);

  const pairs = buildPairs(employees, assignments);

  if (openPair) {
    return (
      <div>
        <button
          onClick={() => setOpenPair(null)}
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: '1.25rem' }}
        >
          <ArrowLeft size={15} strokeWidth={2} />
          Назад к списку
        </button>
        <TalentMapFinalScoreForm
          pairInfo={openPair}
          gradeTargets={gradeTargets}
          bandThresholds={bandThresholds}
          existingAssessment={finalAssessments?.[openPair.evalueeId] || null}
          onSave={onSaveFinalAssessment}
        />
      </div>
    );
  }

  if (pairs.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)' }}>
        Пар пока нет — они появляются для сотрудников, у которых в загруженном списке задан руководитель.
      </p>
    );
  }

  return (
    <div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        Внесите итоговые баллы, согласованные на интервью руководитель–сотрудник. Индекс соответствия и полоса
        оси X считаются автоматически по формуле, без участия AI.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={thStyle}>ФИО</th>
              <th style={thStyle}>Грейд</th>
              <th style={thStyle}>Целевой балл</th>
              <th style={thStyle}>Средний балл</th>
              <th style={thStyle}>ИС%</th>
              <th style={thStyle}>Полоса X</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {pairs.map(pair => {
              const assessment = finalAssessments?.[pair.evalueeId] || null;
              const entered = !!assessment;
              const effectiveBand = getEffectiveBand(assessment, bandThresholds);
              const targetScore = getGradeTarget(gradeTargets, pair.evaluee.grade);
              return (
                <tr key={pair.evalueeId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={tdStyle}>{pair.evaluee.fio}</td>
                  <td style={tdStyle}>{pair.evaluee.grade || '—'}</td>
                  <td style={tdStyle}>{targetScore !== null ? fmt(targetScore) : '—'}</td>
                  <td style={tdStyle}>{entered ? fmt(assessment.overallAverage) : '—'}</td>
                  <td style={tdStyle}>{entered && assessment.complianceIndex !== null ? `${assessment.complianceIndex}%` : '—'}</td>
                  <td style={tdStyle}>
                    <BandBadge band={effectiveBand} />
                    {assessment?.manualOverrideBand && (
                      <span style={{ marginLeft: '0.4rem', fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                        решение комитета
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setOpenPair(pair)}
                      disabled={!pair.ready}
                      title={!pair.ready ? 'Ожидает завершения самооценки и оценки руководителя' : undefined}
                    >
                      {entered ? 'Изменить баллы' : 'Ввести баллы'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TalentMapFinalScoresStep;
