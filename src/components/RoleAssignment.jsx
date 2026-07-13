import React, { useState } from 'react';

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
  const [error, setError] = useState('');

  const handleAdd = () => {
    if (!selectedEvaluee || !selectedRater) {
      setError('Выберите оцениваемого и оценивающего');
      return;
    }

    const newAssign = {
      id: Date.now(),
      evalueeId: selectedEvaluee,
      raterId: selectedRater
    };

    setAssignments([...assignments, newAssign]);
    setSelectedRater('');
    setError('');
  };

  const handleComplete = () => {
    if (assignments.length === 0) {
      setError('Добавьте назначения');
      return;
    }
    // Pass employees as second arg so App.js avoids stale closure when saving to Firestore
    onComplete(assignments, employees);
  };

  const getNameById = (id) => employees.find(e => e.id === id)?.name || 'Unknown';

  return (
    <div className="container">
      <div className="card">
        <BackButton onBack={onBack} />
        <h2>Назначение оценок</h2>

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
              <div key={a.id} style={{ padding: '0.5rem', background: '#f5f5f7', margin: '0.5rem 0' }}>
                <strong>{getNameById(a.evalueeId)}</strong> ← оценивает ← <strong>{getNameById(a.raterId)}</strong>
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