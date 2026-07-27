import React, { useState } from 'react';
import { STANDARD_TRACK, TOP_TRACK, TRACK_LABELS, DEFAULT_TRACK } from '../competencies';

const RELATIONSHIP_TYPES = [
  { value: 'self', label: 'Самооценка' },
  { value: 'manager', label: 'Руководитель' },
  { value: 'colleague', label: 'Коллега' },
  { value: 'subordinate', label: 'Подчиненный' },
];

const LARGE_TEAM_THRESHOLD = 8;

function BackButton({ onBack }) {
  if (!onBack) return null;
  return (
    <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6f6f77', cursor: 'pointer', fontSize: '0.95rem', padding: 0, marginBottom: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
      ← Назад
    </button>
  );
}

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

function RoleAssignment({ employees, onComplete, onBack }) {
  const [assignments, setAssignments] = useState([]);
  const [selectedEvaluee, setSelectedEvaluee] = useState('');
  const [selectedRater, setSelectedRater] = useState('');
  const [selectedType, setSelectedType] = useState('colleague');
  const [error, setError] = useState('');
  const [largeTeamWarning, setLargeTeamWarning] = useState(null);
  const [tracks, setTracks] = useState(() =>
    employees.reduce((acc, e) => ({ ...acc, [e.id]: e.track || DEFAULT_TRACK }), {})
  );

  const hasManagerEmailData = employees.some(e => Object.prototype.hasOwnProperty.call(e, 'managerEmail'));

  const handleTrackChange = (employeeId, track) => {
    setTracks(prev => ({ ...prev, [employeeId]: track }));
  };

  const handleAdd = () => {
    if (!selectedEvaluee || !selectedRater) {
      setError('Выберите оцениваемого и оценивающего');
      return;
    }

    const newAssign = {
      id: Date.now(),
      evalueeId: selectedEvaluee,
      raterId: selectedRater,
      relationType: selectedType,
    };

    setAssignments([...assignments, newAssign]);
    setSelectedRater('');
    setSelectedType('colleague');
    setError('');
  };

  const handleRemoveAssignment = (id) => {
    setAssignments(prev => prev.filter(a => a.id !== id));
  };

  const handleAutoGenerate = () => {
    const generated = buildAutoAssignments(employees);

    setAssignments(prev => {
      const existingKeys = new Set(prev.map(a => `${a.evalueeId}|${a.raterId}|${a.relationType}`));
      const merged = [...prev];
      generated.forEach(g => {
        const key = `${g.evalueeId}|${g.raterId}|${g.relationType}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          merged.push(g);
        }
      });
      return merged;
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
  };

  const handleComplete = () => {
    if (assignments.length === 0) {
      setError('Добавьте назначения');
      return;
    }
    const employeesWithTracks = employees.map(e => ({ ...e, track: tracks[e.id] || DEFAULT_TRACK }));
    onComplete(assignments, employeesWithTracks);
  };

  const getNameById = (id) => employees.find(e => e.id === id)?.name || 'Unknown';
  const getLabelByType = (type) => RELATIONSHIP_TYPES.find(r => r.value === type)?.label || type;

  return (
    <div className="container">
      <div className="card">
        <BackButton onBack={onBack} />
        <h2>Назначение оценок</h2>

        {employees.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>Треки сотрудников</h3>
            <p style={{ color: '#6f6f77', fontSize: '0.85rem', marginTop: 0 }}>
              Определяет, какой набор компетенций увидят все, кто оценивает этого сотрудника.
            </p>
            {employees.map(emp => (
              <div
                key={emp.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.6rem 0.75rem', border: '1px solid #e5e5e7', borderRadius: '8px',
                  marginBottom: '0.5rem', gap: '0.75rem', flexWrap: 'wrap',
                }}
              >
                <span>{emp.name}</span>
                <select
                  value={tracks[emp.id] || DEFAULT_TRACK}
                  onChange={(e) => handleTrackChange(emp.id, e.target.value)}
                  className="input"
                  style={{ width: 'auto', minWidth: '220px' }}
                >
                  <option value={STANDARD_TRACK}>{TRACK_LABELS[STANDARD_TRACK]}</option>
                  <option value={TOP_TRACK}>{TRACK_LABELS[TOP_TRACK]}</option>
                </select>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #e5e5e7', borderRadius: '8px' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.05rem' }}>Автоматическое назначение</h3>
          {hasManagerEmailData ? (
            <>
              <p style={{ color: '#6f6f77', fontSize: '0.85rem' }}>
                Построит самооценку, руководителя, коллег (тех же подчинённых) и подчинённых для каждого
                сотрудника по колонке «Email руководителя». Уже добавленные назначения не дублируются.
              </p>
              <button onClick={handleAutoGenerate} className="btn btn-success">
                🪄 Сгенерировать назначения автоматически
              </button>
            </>
          ) : (
            <p style={{ color: '#6f6f77', fontSize: '0.9rem' }}>
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
              <button onClick={handleAdd} className="btn btn-success">
                + Добавить
              </button>
            )}
          </>
        )}

        {error && <div className="error-message">{error}</div>}

        {assignments.length > 0 && (
          <div style={{ marginTop: '2rem' }}>
            <h3>Добавленные ({assignments.length})</h3>
            {assignments.map(a => (
              <div
                key={a.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.5rem 0.75rem', background: '#f5f5f7', margin: '0.5rem 0', borderRadius: '6px', gap: '0.75rem',
                }}
              >
                <div>
                  <strong>{getNameById(a.evalueeId)}</strong>
                  {' ← '}
                  <span style={{ color: '#6f6f77', fontSize: '0.9rem' }}>{getLabelByType(a.relationType)}</span>
                  {' ← '}
                  <strong>{getNameById(a.raterId)}</strong>
                </div>
                <button
                  onClick={() => handleRemoveAssignment(a.id)}
                  title="Удалить это назначение"
                  style={{
                    background: 'none', border: '1px solid #e5e5e7', borderRadius: '5px',
                    cursor: 'pointer', padding: '0.2rem 0.5rem', fontSize: '0.85rem', color: '#ff3b30',
                  }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}

        <button onClick={handleComplete} className="btn btn-success" style={{ marginTop: '1rem' }}>
          Готово →
        </button>
      </div>
    </div>
  );
}

export default RoleAssignment;
