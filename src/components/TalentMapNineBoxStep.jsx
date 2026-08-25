import React, { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { TALENT_ASSIGNMENT_SELF, TALENT_ASSIGNMENT_MANAGER } from '../talentAssignments';
import { getEffectiveBand, TALENT_BAND_LABELS } from '../talentCompliance';
import {
  Y_AXIS_ORDER, X_AXIS_ORDER, getQuadrant, quadrantKey, ZONE_STYLE, POOL_LABELS, POOL_NONE,
  computeEffectiveYBand,
} from '../talentNineBox';
import TalentMapYAxisEditor from './TalentMapYAxisEditor';
import TalentMapQuadrantEditor from './TalentMapQuadrantEditor';
import TalentMapTalentPools from './TalentMapTalentPools';
import TalentMapDistributionCheck from './TalentMapDistributionCheck';

// Тот же способ построить пары «оцениваемый + его руководитель» из
// сохранённых assignments, что TalentMapPairReportsStep.jsx/
// TalentMapFinalScoresStep.jsx (Фазы 3–4) используют внутри себя —
// продублирован намеренно, а не вынесен в общий модуль, чтобы не трогать
// код прошлых фаз.
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
      const evaluee = getEmployee(evalueeId);
      const manager = getEmployee(managerTask.raterId);
      return { evalueeId, evaluee, manager, selfTask: tasks[TALENT_ASSIGNMENT_SELF], managerTask };
    })
    .filter(p => p.evaluee && p.manager)
    .sort((a, b) => a.evaluee.fio.localeCompare(b.evaluee.fio, 'ru'));
}

function CellCard({ quadrant, employees }) {
  const style = ZONE_STYLE[quadrant.zone] || ZONE_STYLE.yellow;
  return (
    <div style={{
      border: `1.5px solid ${style.border}`, borderRadius: 'var(--radius-card)', background: style.bg,
      padding: '0.9rem', minHeight: '160px', display: 'flex', flexDirection: 'column', gap: '0.35rem',
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: style.text }}>{quadrant.name}</div>
      {quadrant.pool !== POOL_NONE && (
        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: style.text }}>{POOL_LABELS[quadrant.pool]}</div>
      )}
      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{quadrant.action}</div>
      <div style={{ marginTop: 'auto', paddingTop: '0.4rem', fontSize: '0.82rem', fontWeight: 600, color: style.text }}>
        {employees.length === 0 ? 'Никого' : `${employees.length} чел.`}
      </div>
      {employees.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', color: 'var(--color-text)' }}>
          {employees.map(e => <li key={e.evalueeId}>{e.evaluee.fio}</li>)}
        </ul>
      )}
    </div>
  );
}

// Под-шаг «Карта талантов» (Фаза 5a) — ручная ось Y (KPI), карта 9-box,
// редактируемые ячейки, пулы талантов и проверка распределения. Ось X
// приходит готовой из Фазы 4 (talentMaps.finalAssessments), ничего не
// пересчитывает заново.
function TalentMapNineBoxStep({
  employees, assignments, bandThresholds,
  finalAssessments, yAxisAssessments, quadrants, talentPoolOverrides,
  onSaveYAxis, onSaveQuadrants, onSavePoolOverride,
}) {
  const [showQuadrantEditor, setShowQuadrantEditor] = useState(false);

  const pairs = buildPairs(employees, assignments);

  const placement = pairs.map(p => {
    const xBand = getEffectiveBand(finalAssessments?.[p.evalueeId] || null, bandThresholds);
    const yBand = computeEffectiveYBand(yAxisAssessments?.[p.evalueeId] || null, bandThresholds);
    return { ...p, xBand, yBand };
  });

  const placed = placement.filter(p => p.xBand && p.yBand);
  const unplaced = placement.filter(p => !p.xBand || !p.yBand);

  if (pairs.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)' }}>
        Пар пока нет — они появляются для сотрудников, у которых в загруженном списке задан руководитель.
      </p>
    );
  }

  return (
    <div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1.75rem' }}>
        Ось X (индекс соответствия) считается автоматически по данным Фазы 4. Ось Y (KPI) вносится вручную ниже —
        выберите полосу или укажите % выполнения плана, чтобы она посчиталась по тем же порогам, что и ось X.
      </p>

      <h4 style={{ marginBottom: '0.75rem' }}>Ось Y — KPI</h4>
      <div style={{ marginBottom: '2.5rem' }}>
        <TalentMapYAxisEditor
          pairs={placement}
          bandThresholds={bandThresholds}
          yAxisAssessments={yAxisAssessments}
          onSave={onSaveYAxis}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.9rem' }}>
        <h4 style={{ margin: 0 }}>Карта 9-box</h4>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowQuadrantEditor(v => !v)}>
          <Settings2 size={14} strokeWidth={2} />
          {showQuadrantEditor ? 'Скрыть настройку ячеек' : 'Настроить ячейки'}
        </button>
      </div>

      <div style={{ overflowX: 'auto', marginBottom: '0.75rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '150px repeat(3, minmax(200px, 1fr))', gap: '0.6rem', minWidth: '760px' }}>
          <div />
          {X_AXIS_ORDER.map(xBand => (
            <div key={xBand} style={{ textAlign: 'center', fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
              {TALENT_BAND_LABELS[xBand]}
            </div>
          ))}
          {Y_AXIS_ORDER.map(yBand => (
            <React.Fragment key={yBand}>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-muted)' }}>
                {TALENT_BAND_LABELS[yBand]}
              </div>
              {X_AXIS_ORDER.map(xBand => {
                const quadrant = getQuadrant(quadrants, yBand, xBand);
                const cellEmployees = placed.filter(p => p.yBand === yBand && p.xBand === xBand);
                return <CellCard key={quadrantKey(yBand, xBand)} quadrant={quadrant} employees={cellEmployees} />;
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
        Столбцы — ось X (индекс соответствия), строки — ось Y (KPI).
      </p>

      {showQuadrantEditor && (
        <div style={{ marginBottom: '2rem' }}>
          <TalentMapQuadrantEditor quadrants={quadrants} onSave={onSaveQuadrants} />
        </div>
      )}

      {unplaced.length > 0 && (
        <div style={{
          marginBottom: '2.5rem', padding: '1rem 1.25rem', border: '1px dashed var(--color-border)',
          borderRadius: 'var(--radius-card)', background: 'var(--color-surface-tint)',
        }}>
          <h5 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Не размещены ({unplaced.length})</h5>
          <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
            Не хватает полосы X (Фаза 4 — финальные баллы) или Y (KPI выше).
          </p>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem' }}>
            {unplaced.map(p => (
              <li key={p.evalueeId}>
                {p.evaluee.fio}
                {' — '}
                {!p.xBand && !p.yBand ? 'нет ни X, ни Y' : !p.xBand ? 'нет X' : 'нет Y'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginBottom: '2.5rem' }}>
        <TalentMapTalentPools
          placement={placement}
          quadrants={quadrants}
          talentPoolOverrides={talentPoolOverrides}
          employees={employees}
          onSaveOverride={onSavePoolOverride}
        />
      </div>

      <TalentMapDistributionCheck placement={placement} quadrants={quadrants} />
    </div>
  );
}

export default TalentMapNineBoxStep;
