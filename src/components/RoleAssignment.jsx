import React, { useState } from 'react';
import { Wand2, Trash2 } from 'lucide-react';

const RELATIONSHIP_TYPES = [
  { value: 'self', label: 'Самооценка' },
  { value: 'manager', label: 'Руководитель' },
  { value: 'colleague', label: 'Коллега' },
  { value: 'subordinate', label: 'Подчиненный' },
];

const LARGE_TEAM_THRESHOLD = 8;

// Builds assignments from org-chart data (email / managerEmail) alone:
//   - everyone rates themselves (self)
//   - a person's manager rates them (manager)
//   - a person's direct reports rate them (subordinate)
//   - everyone sharing that person's manager rates them (colleague)
// Matching is by email, not name, per the task's requirement.
function buildAutoAssignments(employees) {
  const byEmail = new Map(
    employees
      .filter(e => e.email)
      .map(e => [e.email.trim().toLowerCase(), e])
  );
  const norm = (email) => (email || '').trim().toLowerCase();
  const generated = [];
  let counter = 0;
  const makeId = () => `auto_${Date.now()}_${counter++}`;

  employees.forEach(emp => {
    generated.push({ id: makeId(), evalueeId: emp.id, raterId: emp.id, relationType: 'self' });

    const managerEmail = norm(emp.managerEmail);
    const manager = managerEmail ? byEmail.get(managerEmail) : null;
    if (manager && manager.id !== emp.id) {
      generated.push({ id: makeId(), evalueeId: emp.id, raterId: manager.id, relationType: 'manager' });
    }

    employees
      .filter(other => other.id !== emp.id && norm(other.managerEmail) === norm(emp.email))
      .forEach(sub => {
        generated.push({ id: makeId(), evalueeId: emp.id, raterId: sub.id, relationType: 'subordinate' });
      });

    if (managerEmail) {
      employees
        .filter(other => other.id !== emp.id && norm(other.managerEmail) === managerEmail)
        .forEach(colleague => {
          generated.push({ id: makeId(), evalueeId: emp.id, raterId: colleague.id, relationType: 'colleague' });
        });
    }
  });

  return generated;
}

function assignmentKey(a) {
  return `${a.evalueeId}|${a.raterId}|${a.relationType}`;
}

// Step 2 of Настройка опроса: a persistent assignments panel — no more
// one-shot wizard. `assignments` is always the current, real, saved state
// (no local draft copy); every action calls onSave with the full next
// array immediately, so this never drifts from what's actually persisted.
// Deleting a single assignment reuses AdminDashboard's existing confirm+
// delete flow via onDeleteAssignment, keeping that behavior identical to
// the Приглашения tab's delete action.
function RoleAssignment({ employees, assignments, onSave, onDeleteAssignment }) {
  const [selectedEvaluee, setSelectedEvaluee] = useState('');
  const [selectedRater, setSelectedRater] = useState('');
  const [selectedType, setSelectedType] = useState('colleague');
  const [error, setError] = useState('');
  const [largeTeamWarning, setLargeTeamWarning] = useState(null);

  const hasManagerEmailData = employees.some(e => Object.prototype.hasOwnProperty.call(e, 'managerEmail'));

  const getNameById = (id) => employees.find(e => e.id === id)?.name || 'Unknown';

  const handleAdd = () => {
    if (!selectedEvaluee || !selectedRater) {
      setError('Выберите оцениваемого и оценивающего');
      return;
    }
    const key = `${selectedEvaluee}|${selectedRater}|${selectedType}`;
    if (assignments.some(a => assignmentKey(a) === key)) {
      setError('Такое назначение уже существует');
      return;
    }

    const newAssign = { id: `manual_${Date.now()}`, evalueeId: selectedEvaluee, raterId: selectedRater, relationType: selectedType };
    onSave([...assignments, newAssign]);
    setSelectedRater('');
    setSelectedType('colleague');
    setError('');
  };

  const handleAutoGenerate = () => {
    const generated = buildAutoAssignments(employees);

    const existingKeys = new Set(assignments.map(assignmentKey));
    const merged = [...assignments];
    generated.forEach(g => {
      const key = assignmentKey(g);
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        merged.push(g);
      }
    });

    const colleagueCounts = {};
    generated.forEach(g => {
      if (g.relationType === 'colleague') {
        colleagueCounts[g.evalueeId] = (colleagueCounts[g.evalueeId] || 0) + 1;
      }
    });
    const overloaded = Object.entries(colleagueCounts)
      .filter(([, count]) => count > LARGE_TEAM_THRESHOLD)
      .map(([evalueeId, count]) => ({ name: getNameById(evalueeId), count }));
    setLargeTeamWarning(overloaded.length > 0 ? overloaded : null);
    setError('');
    onSave(merged);
  };

  const handleTypeChange = (assignment, newType) => {
    if (newType === assignment.relationType) return;
    const key = `${assignment.evalueeId}|${assignment.raterId}|${newType}`;
    const collides = assignments.some(a => a.id !== assignment.id && assignmentKey(a) === key);
    if (collides) {
      alert('Назначение с таким типом для этой пары уже существует');
      return;
    }
    onSave(assignments.map(a => a.id === assignment.id ? { ...a, relationType: newType } : a));
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-btn)' }}>
        <h4 style={{ marginTop: 0, fontSize: '1.05rem' }}>Автоматическое назначение</h4>
        {hasManagerEmailData ? (
          <>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              Построит самооценку, руководителя, коллег (тех же подчинённых) и подчинённых для каждого
              сотрудника по колонке «Email руководителя». Уже добавленные назначения не дублируются.
            </p>
            <button onClick={handleAutoGenerate} className="btn btn-secondary btn-sm">
              <Wand2 size={15} strokeWidth={2} />
              Сгенерировать автоматически
            </button>
          </>
        ) : (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            В загруженном файле нет колонки «Email руководителя», поэтому автоматическое назначение
            недоступно. Назначьте оценивающих вручную ниже.
          </p>
        )}
      </div>

      {largeTeamWarning && (
        <div style={{
          marginBottom: '1.5rem', padding: '1rem', borderRadius: '8px',
          background: '#fff8e6', border: '1px solid #f0d585', color: '#7a5c00',
        }}>
          <strong>Внимание:</strong> у некоторых сотрудников получилось много «коллег»-оценивающих.
          Возможно, стоит убрать часть вручную в списке ниже:
          <ul style={{ marginTop: '0.5rem', marginBottom: 0, paddingLeft: '1.25rem' }}>
            {largeTeamWarning.map(w => (
              <li key={w.name}>{w.name} — {w.count} коллег</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-btn)' }}>
        <h4 style={{ marginTop: 0, fontSize: '1.05rem' }}>Добавить вручную</h4>
        <div className="form-group">
          <label>Оцениваемый:</label>
          <select
            value={selectedEvaluee}
            onChange={(e) => setSelectedEvaluee(e.target.value)}
            className="input"
          >
            <option value="">-- Выберите --</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.name}</option>
            ))}
          </select>
        </div>

        {selectedEvaluee && (
          <>
            <div className="form-group">
              <label>Оценивающий:</label>
              <select
                value={selectedRater}
                onChange={(e) => setSelectedRater(e.target.value)}
                className="input"
              >
                <option value="">-- Выберите --</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Тип отношений:</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="input"
              >
                {RELATIONSHIP_TYPES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {selectedRater && (
              <button onClick={handleAdd} className="btn btn-secondary btn-sm">
                + Добавить
              </button>
            )}
          </>
        )}

        {error && <div className="error-message">{error}</div>}
      </div>

      <div>
        <h4 style={{ fontSize: '1.05rem' }}>Все назначения ({assignments.length})</h4>
        {assignments.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Назначений пока нет.</p>
        ) : (
          assignments.map(a => (
            <div
              key={a.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.6rem 0.75rem', background: '#fff', border: '1px solid var(--color-border)',
                margin: '0.5rem 0', borderRadius: 'var(--radius-btn)', gap: '0.75rem', flexWrap: 'wrap',
              }}
            >
              <div>
                <strong>{getNameById(a.evalueeId)}</strong>
                {' ← '}
                <strong>{getNameById(a.raterId)}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <select
                  value={a.relationType}
                  onChange={(e) => handleTypeChange(a, e.target.value)}
                  className="input"
                  style={{ width: 'auto', padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                  title="Изменить тип отношений"
                >
                  {RELATIONSHIP_TYPES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => onDeleteAssignment(a)}
                  title="Удалить это назначение"
                  className="btn btn-icon btn-danger-ghost"
                >
                  <Trash2 size={16} strokeWidth={2} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default RoleAssignment;
