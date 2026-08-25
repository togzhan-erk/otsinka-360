import React, { useState } from 'react';
import { ArrowLeft, FileText, Sparkles } from 'lucide-react';
import { TALENT_ASSIGNMENT_MANAGER } from '../talentAssignments';
import TalentMapIdpDetail from './TalentMapIdpDetail';

// Тот же способ построить пары «оцениваемый + его руководитель» из
// сохранённых assignments, что остальные под-шаги карты (Фазы 3–5a)
// используют внутри себя — продублирован намеренно, чтобы не трогать код
// прошлых фаз.
function buildPairs(employees, assignments) {
  const byEvaluee = new Map();
  assignments.forEach(a => {
    if (!byEvaluee.has(a.evalueeId)) byEvaluee.set(a.evalueeId, {});
    byEvaluee.get(a.evalueeId)[a.type] = a;
  });

  const getEmployee = (id) => employees.find(e => e.id === id);

  return [...byEvaluee.entries()]
    .filter(([, tasks]) => tasks[TALENT_ASSIGNMENT_MANAGER])
    .map(([evalueeId]) => ({ evalueeId, evaluee: getEmployee(evalueeId) }))
    .filter(p => p.evaluee)
    .sort((a, b) => a.evaluee.fio.localeCompare(b.evaluee.fio, 'ru'));
}

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
  color: 'var(--color-text-muted)', textAlign: 'left',
};
const tdStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'middle', fontSize: '0.88rem' };

function fmt(n) {
  return n !== null && n !== undefined ? n.toFixed(2).replace('.', ',') : '—';
}

// Под-шаг «План развития» (Фаза 5b) — список сотрудников, у которых уже
// внесены финальные баллы (Фаза 4); без них план развития строить не на
// чем. Открытие сотрудника показывает TalentMapIdpDetail — баллы по
// компетенциям, AI-план и его PDF (без ярлыков карты 9-box).
function TalentMapIdpStep({ employees, assignments, finalAssessments, idpPlans, onSavePlan }) {
  const [openId, setOpenId] = useState(null);

  const pairs = buildPairs(employees, assignments).filter(p => finalAssessments?.[p.evalueeId]);

  if (openId) {
    const pair = pairs.find(p => p.evalueeId === openId);
    if (!pair) {
      return (
        <div>
          <button onClick={() => setOpenId(null)} className="btn btn-ghost btn-sm" style={{ marginBottom: '1.25rem' }}>
            <ArrowLeft size={15} strokeWidth={2} />
            Назад к списку
          </button>
          <p style={{ color: 'var(--color-text-muted)' }}>Сотрудник больше не в списке — вернитесь к списку.</p>
        </div>
      );
    }
    return (
      <div>
        <button onClick={() => setOpenId(null)} className="btn btn-ghost btn-sm" style={{ marginBottom: '1.25rem' }}>
          <ArrowLeft size={15} strokeWidth={2} />
          Назад к списку
        </button>
        <TalentMapIdpDetail
          evaluee={pair.evaluee}
          finalAssessment={finalAssessments[openId]}
          existingPlan={idpPlans?.[openId] || null}
          onSavePlan={onSavePlan}
        />
      </div>
    );
  }

  if (pairs.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)' }}>
        Пока нет сотрудников с внесёнными финальными баллами — сначала заполните их на шаге «Согласованные баллы».
      </p>
    );
  }

  return (
    <div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        AI-план развития по финальным баллам сотрудника — сильные стороны, зоны роста и конкретные шаги. Без ярлыков
        карты 9-box: этот план можно показать самому сотруднику.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={thStyle}>ФИО</th>
              <th style={thStyle}>Грейд</th>
              <th style={thStyle}>Средний балл</th>
              <th style={thStyle}>План развития</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {pairs.map(p => {
              const assessment = finalAssessments[p.evalueeId];
              const hasPlan = !!idpPlans?.[p.evalueeId];
              return (
                <tr key={p.evalueeId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={tdStyle}>{p.evaluee.fio}</td>
                  <td style={tdStyle}>{p.evaluee.grade || '—'}</td>
                  <td style={tdStyle}>{fmt(assessment.overallAverage)}</td>
                  <td style={tdStyle}>
                    {hasPlan ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--color-success)', fontWeight: 600 }}>
                        <FileText size={14} strokeWidth={2} />
                        Готов
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: 'var(--color-text-muted)' }}>
                        <Sparkles size={14} strokeWidth={2} />
                        Не сгенерирован
                      </span>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setOpenId(p.evalueeId)}>
                      {hasPlan ? 'Открыть' : 'Сгенерировать'}
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

export default TalentMapIdpStep;
