import React, { useState } from 'react';
import { ArrowLeft, FileText, CheckCircle2, Clock } from 'lucide-react';
import { TALENT_ASSIGNMENT_SELF, TALENT_ASSIGNMENT_MANAGER } from '../talentAssignments';
import TalentMapPairReport from './TalentMapPairReport';

// Пара = сотрудник (оцениваемый) + его руководитель, определяется теми же
// сохранёнными assignments, что и шаг «Прохождение»: у оцениваемого всегда
// есть self_<id> (самооценка), а manager_<managerId>_<id> существует только
// если у него в оргструктуре реально задан руководитель — сотрудники без
// руководителя (самый верх иерархии) в список пар не попадают, для них
// сравнивать не с чем.
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
      const selfDone = selfTask?.status === 'completed';
      const managerDone = managerTask?.status === 'completed';
      return {
        evalueeId,
        evaluee,
        manager,
        selfTask,
        managerTask,
        selfDone,
        managerDone,
        ready: selfDone && managerDone,
      };
    })
    .filter(p => p.evaluee && p.manager)
    .sort((a, b) => a.evaluee.fio.localeCompare(b.evaluee.fio, 'ru'));
}

function missingLabel(pair) {
  if (!pair.selfDone && !pair.managerDone) return 'Ожидается: самооценка и оценка руководителя';
  if (!pair.selfDone) return 'Ожидается: самооценка';
  return 'Ожидается: оценка руководителя';
}

function ReadinessBadge({ ready }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.15rem 0.6rem', borderRadius: 999,
      fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap',
      background: ready ? 'rgba(91, 140, 110, 0.14)' : 'var(--color-surface-tint)',
      color: ready ? 'var(--color-success)' : 'var(--color-text-muted)',
    }}>
      {ready ? <CheckCircle2 size={13} strokeWidth={2} /> : <Clock size={13} strokeWidth={2} />}
      {ready ? 'Обе оценки готовы' : 'Не завершено'}
    </span>
  );
}

// Шаг «Отчёты по парам» — список плюс переключение на детальный отчёт
// (TalentMapPairReport) внутри того же шага, без отдельной навигации в
// TalentMapTab.jsx.
function TalentMapPairReportsStep({ employees, assignments, ownerUid, pairComments, onSaveComment }) {
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
          Назад к списку пар
        </button>
        <TalentMapPairReport
          pair={openPair}
          ownerUid={ownerUid}
          existingComment={pairComments?.[openPair.evalueeId] || null}
          onSaveComment={(comment) => onSaveComment(openPair.evalueeId, comment)}
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
        Отчёт по паре доступен, когда завершены обе оценки — самооценка сотрудника и оценка его руководителя.
      </p>
      {pairs.map(pair => (
        <div
          key={pair.evalueeId}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem',
            padding: '1rem 1.25rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
            marginBottom: '0.75rem', background: '#fff',
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>{pair.evaluee.fio}</div>
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '0.15rem' }}>
              Руководитель: {pair.manager.fio}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <ReadinessBadge ready={pair.ready} />
            {!pair.ready && (
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{missingLabel(pair)}</span>
            )}
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setOpenPair(pair)}
              disabled={!pair.ready}
            >
              <FileText size={15} strokeWidth={2} />
              Открыть отчёт
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default TalentMapPairReportsStep;
