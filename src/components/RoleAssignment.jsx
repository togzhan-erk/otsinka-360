import React, { useState } from 'react';
import { STANDARD_TRACK, TOP_TRACK, TRACK_LABELS, DEFAULT_TRACK } from '../competencies';

const RELATIONSHIP_TYPES = [
  { value: 'self', label: 'Самооценка' },
  { value: 'manager', label: 'Руководитель' },
  { value: 'colleague', label: 'Коллега' },
  { value: 'subordinate', label: 'Подчиненный' },
];

function BackButton({ onBack }) {
  if (!onBack) return null;
  return (
    <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6f6f77', cursor: 'pointer', fontSize: '0.95rem', padding: 0, marginBottom: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
      ← Назад
    </button>
  );
}

function RoleAssignment({ employees, onComplete, onBack }) {
  const [assignments, setAssignments] = useState([]);
  const [selectedEvaluee, setSelectedEvaluee] = useState('');
  const [selectedRater, setSelectedRater] = useState('');
  const [selectedType, setSelectedType] = useState('colleague');
  const [error, setError] = useState('');
  const [tracks, setTracks] = useState(() =>
    employees.reduce((acc, e) => ({ ...acc, [e.id]: e.track || DEFAULT_TRACK }), {})
  );

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
              <div key={a.id} style={{ padding: '0.5rem', background: '#f5f5f7', margin: '0.5rem 0', borderRadius: '6px' }}>
                <strong>{getNameById(a.evalueeId)}</strong>
                {' ← '}
                <span style={{ color: '#6f6f77', fontSize: '0.9rem' }}>{getLabelByType(a.relationType)}</span>
                {' ← '}
                <strong>{getNameById(a.raterId)}</strong>
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
