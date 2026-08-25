import React from 'react';
import { User, Users, ChevronRight } from 'lucide-react';

const STATUS_LABELS = { not_started: 'Не начата', in_progress: 'В процессе', completed: 'Завершена' };
const STATUS_STYLE = {
  not_started: { color: '#B42318', bg: '#FCE8E6' },
  in_progress: { color: '#8A5A22', bg: 'rgba(226, 145, 71, 0.14)' },
  completed: { color: 'var(--color-success)', bg: 'rgba(91, 140, 110, 0.14)' },
};

function StatusPill({ status }) {
  const s = status || 'not_started';
  const style = STATUS_STYLE[s] || STATUS_STYLE.not_started;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '0.25rem 0.7rem', borderRadius: 999,
      fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap',
      background: style.bg, color: style.color,
    }}>
      {STATUS_LABELS[s]}
    </span>
  );
}

// Единственная точка входа — личная ссылка вида ?talentToken=... (App.js),
// разрешённая сервером через api/talent-tasks.mjs. Никаких обращений к
// Firestore с клиента: только задачи этого конкретного токена, ничьи чужие
// оценки сюда не попадают (сервер фильтрует по raterId).
function TalentTaskList({ raterName, tasks, onOpenTask }) {
  return (
    <div className="container">
      <div className="card" style={{ maxWidth: '640px' }}>
        <h2>Карта талантов</h2>
        <p className="subtitle">
          Здравствуйте, {raterName}. Ваши задачи оценки:
        </p>

        {tasks.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Задач пока нет.</p>
        ) : (
          tasks.map(task => (
            <button key={task.id} type="button" className="talent-task-card" onClick={() => onOpenTask(task.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {task.type === 'self'
                  ? <User size={18} strokeWidth={2} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                  : <Users size={18} strokeWidth={2} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />}
                <span style={{ fontWeight: 600 }}>
                  {task.type === 'self' ? 'Оценить себя' : `Оценить: ${task.evalueeName}`}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <StatusPill status={task.status} />
                <ChevronRight size={16} strokeWidth={2} style={{ color: 'var(--color-text-muted)' }} />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export default TalentTaskList;
