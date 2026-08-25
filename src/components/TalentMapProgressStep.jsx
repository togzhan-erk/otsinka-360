import React, { useState } from 'react';
import { ClipboardList, Copy, Check } from 'lucide-react';
import { TALENT_ASSIGNMENT_SELF, TALENT_ASSIGNMENT_MANAGER } from '../talentAssignments';
import { buildTalentLink } from '../talentLinks';

const TYPE_LABELS = {
  [TALENT_ASSIGNMENT_SELF]: 'Самооценка',
  [TALENT_ASSIGNMENT_MANAGER]: 'Оценка руководителя',
};

const STATUS_LABELS = { not_started: 'Не начата', in_progress: 'В процессе', completed: 'Завершена' };
const STATUS_STYLE = {
  not_started: { color: 'var(--color-text-muted)', bg: 'var(--color-surface-tint)' },
  in_progress: { color: 'var(--color-accent-hover)', bg: 'rgba(226, 145, 71, 0.14)' },
  completed: { color: 'var(--color-success)', bg: 'rgba(91, 140, 110, 0.14)' },
};

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
  color: 'var(--color-text-muted)', textAlign: 'left',
};
const tdStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'middle', fontSize: '0.88rem' };

function StatusBadge({ status }) {
  const s = status || 'not_started';
  const style = STATUS_STYLE[s] || STATUS_STYLE.not_started;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '0.15rem 0.55rem', borderRadius: 999,
      fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
      background: style.bg, color: style.color,
    }}>
      {STATUS_LABELS[s]}
    </span>
  );
}

// «Прохождение» — контроль сбора оценок поверх того, что реально сохранено
// в talentMaps/{uid}.assignments (тот же массив, что TalentMapTab.jsx уже
// держит через живую подписку onSnapshot — здесь ничего не пересчитывается
// заново, только отображается). Не трогает и не дублирует логику шага
// «Распределение» (Фаза 1/2) — отдельный, самостоятельный компонент.
function TalentMapProgressStep({ employees, assignments }) {
  const [copiedId, setCopiedId] = useState(null);

  const getEmployee = (id) => employees.find(e => e.id === id);

  const total = assignments.length;
  const completed = assignments.filter(a => a.status === 'completed').length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const handleCopy = async (raterId, link) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(raterId);
      setTimeout(() => setCopiedId(prev => (prev === raterId ? null : prev)), 2000);
    } catch (err) {
      console.error('[TalentMapProgressStep] Clipboard copy error:', err);
    }
  };

  if (employees.length === 0 || total === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)' }}>
        Пока нет сохранённого распределения задач. Загрузите сотрудников на шаге «Загрузка» —
        назначения сохранятся автоматически.
      </p>
    );
  }

  const raterIds = [...new Set(assignments.map(a => a.raterId))];

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.95rem' }}>
          <strong>Пройдено задач: {completed} из {total} ({pct}%)</strong>
        </div>
        <div style={{ background: 'var(--color-border)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
          <div
            style={{
              width: `${pct}%`, height: '100%', borderRadius: 999,
              background: pct === 100 ? 'var(--color-success)' : 'var(--color-leaf)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      <div style={{ overflowX: 'auto', marginBottom: '2.5rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={thStyle}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <ClipboardList size={14} strokeWidth={2} />
                  Оценивающий
                </span>
              </th>
              <th style={thStyle}>Кого оценивает</th>
              <th style={thStyle}>Тип</th>
              <th style={thStyle}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map(a => {
              const incomplete = a.status !== 'completed';
              return (
                <tr
                  key={a.id}
                  style={{
                    borderBottom: '1px solid var(--color-border)',
                    background: incomplete ? 'rgba(226, 145, 71, 0.06)' : 'transparent',
                    borderLeft: incomplete ? '3px solid var(--color-accent)' : '3px solid transparent',
                  }}
                >
                  <td style={tdStyle}>{getEmployee(a.raterId)?.fio || '—'}</td>
                  <td style={tdStyle}>{getEmployee(a.evalueeId)?.fio || '—'}</td>
                  <td style={tdStyle}>{TYPE_LABELS[a.type]}</td>
                  <td style={tdStyle}><StatusBadge status={a.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <h4 style={{ marginBottom: '0.35rem' }}>Персональные ссылки</h4>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
          Скопируйте ссылку и перешлите сотруднику вручную — массовая рассылка на этом этапе не делается.
        </p>
        {raterIds.map(raterId => {
          const rater = getEmployee(raterId);
          if (!rater) return null;
          const link = rater.token ? buildTalentLink(rater.token) : null;
          const raterTasks = assignments.filter(a => a.raterId === raterId);
          const raterCompleted = raterTasks.filter(a => a.status === 'completed').length;
          return (
            <div
              key={raterId}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem',
                padding: '0.85rem 1.1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
                marginBottom: '0.6rem', background: '#fff',
              }}
            >
              <div>
                <strong>{rater.fio}</strong>{' '}
                <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                  · {raterCompleted} из {raterTasks.length} задач завершено
                </span>
              </div>
              {link ? (
                <button className="btn btn-secondary btn-sm" onClick={() => handleCopy(raterId, link)}>
                  {copiedId === raterId ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
                  {copiedId === raterId ? 'Скопировано' : 'Скопировать ссылку'}
                </button>
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Нет токена</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TalentMapProgressStep;
