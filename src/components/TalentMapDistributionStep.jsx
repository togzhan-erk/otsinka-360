import React, { useMemo, useState } from 'react';
import { ClipboardList, Save } from 'lucide-react';
import { computeTalentAssignments, TALENT_ASSIGNMENT_SELF, TALENT_ASSIGNMENT_MANAGER } from '../talentAssignments';

const TYPE_LABELS = {
  [TALENT_ASSIGNMENT_SELF]: 'Самооценка',
  [TALENT_ASSIGNMENT_MANAGER]: 'Оценка руководителя',
};

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
  color: 'var(--color-text-muted)', textAlign: 'left',
};
const tdStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'middle', fontSize: '0.88rem' };

function StatCard({ label, value }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
      padding: '1.25rem 1.5rem', minWidth: '180px', flex: '1 1 180px',
    }}>
      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>{label}</div>
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: '2rem', fontWeight: 700, color: 'var(--color-primary)', lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

// Шаг 2 «Распределение»: чисто превью, построенное на лету из текущего
// списка сотрудников (computeTalentAssignments — детерминированная функция,
// см. src/talentAssignments.js), плюс необязательное сохранение этого же
// снимка в Firestore для следующей фазы (рассылка ссылок). Рассылку и сбор
// ответов эта фаза не делает.
function TalentMapDistributionStep({ employees, onSaveAssignments }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  const assignments = useMemo(() => computeTalentAssignments(employees), [employees]);
  const getEmployee = (id) => employees.find(e => e.id === id);

  const selfCount = assignments.filter(a => a.type === TALENT_ASSIGNMENT_SELF).length;
  const managerCount = assignments.filter(a => a.type === TALENT_ASSIGNMENT_MANAGER).length;

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await onSaveAssignments(assignments);
      setSaved(true);
    } catch (err) {
      console.error('[TalentMapDistributionStep] Failed to save assignments:', err);
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (employees.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)' }}>
        Сначала загрузите сотрудников на шаге «Загрузка».
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <StatCard label="Всего задач оценки" value={assignments.length} />
        <StatCard label="Из них самооценок" value={selfCount} />
        <StatCard label="Оценок руководителей" value={managerCount} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          Превью распределения — рассылка ссылок и сбор ответов будут добавлены на следующем этапе.
        </p>
        <button className="btn btn-secondary btn-sm" onClick={handleSave} disabled={saving}>
          <Save size={15} strokeWidth={2} />
          {saving ? 'Сохранение...' : 'Сохранить распределение'}
        </button>
      </div>

      {saved && <div className="info-message">Распределение сохранено.</div>}
      {saveError && <div className="error-message">Ошибка сохранения: {saveError}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={thStyle}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <ClipboardList size={14} strokeWidth={2} />
                  Оценивающий
                </span>
              </th>
              <th style={thStyle}>Оцениваемый</th>
              <th style={thStyle}>Тип</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map(a => (
              <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={tdStyle}>{getEmployee(a.raterId)?.fio || '—'}</td>
                <td style={tdStyle}>{getEmployee(a.evalueeId)?.fio || '—'}</td>
                <td style={tdStyle}>{TYPE_LABELS[a.type]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TalentMapDistributionStep;
