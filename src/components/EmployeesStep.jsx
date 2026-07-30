import React, { useState } from 'react';
import { Upload, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import AdminUpload from './AdminUpload';
import { STANDARD_TRACK, TOP_TRACK, TRACK_LABELS, DEFAULT_TRACK } from '../competencies';

let manualIdCounter = 0;
function makeEmployeeId() {
  return `emp_manual_${Date.now()}_${manualIdCounter++}`;
}

const EMPTY_FORM = { name: '', email: '', managerEmail: '', department: '', track: DEFAULT_TRACK };

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.03em',
  color: 'var(--color-text-muted)', textTransform: 'uppercase', textAlign: 'left',
};
const tdStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'middle', fontSize: '0.88rem' };
const inputSm = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', width: '100%' };

function TrackSelect({ value, onChange, style }) {
  return (
    <select className="input" style={{ ...inputSm, ...style }} value={value || DEFAULT_TRACK} onChange={(e) => onChange(e.target.value)}>
      <option value={STANDARD_TRACK}>{TRACK_LABELS[STANDARD_TRACK]}</option>
      <option value={TOP_TRACK}>{TRACK_LABELS[TOP_TRACK]}</option>
    </select>
  );
}

// Step 1 of Настройка опроса: a persistent, always-editable roster for the
// active cycle. onSave(newEmployees, newAssignments) always carries BOTH
// arrays (matching App.js's onSetupComplete signature) since deleting an
// employee needs to drop their assignments in the same write; every other
// action just passes the current assignments through unchanged.
function EmployeesStep({ employees, assignments, onSave }) {
  const [showUpload, setShowUpload] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_FORM);
  const [addError, setAddError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  // Merges an Excel re-upload into the existing roster by email instead of
  // replacing it: a matched row updates name/managerEmail/department but
  // keeps the existing id and track (so assignments and deliberate track
  // choices survive a re-import); an unmatched row is added as new. The
  // parsing itself (AdminUpload.jsx) is untouched.
  const handleExcelUpload = (parsedEmployees) => {
    const byEmail = new Map(employees.map(e => [e.email.trim().toLowerCase(), e]));
    const merged = [...employees];
    parsedEmployees.forEach(row => {
      const key = row.email.trim().toLowerCase();
      const existing = byEmail.get(key);
      if (existing) {
        const idx = merged.findIndex(e => e.id === existing.id);
        merged[idx] = {
          ...existing,
          name: row.name,
          managerEmail: row.managerEmail ?? existing.managerEmail ?? '',
          department: row.department ?? existing.department ?? '',
        };
      } else {
        const newEmployee = {
          id: makeEmployeeId(),
          name: row.name,
          email: row.email,
          managerEmail: row.managerEmail || '',
          department: row.department || '',
          track: DEFAULT_TRACK,
        };
        merged.push(newEmployee);
        byEmail.set(key, newEmployee);
      }
    });
    onSave(merged, assignments);
    setShowUpload(false);
  };

  const handleAddSubmit = (e) => {
    e.preventDefault();
    if (!addForm.name.trim() || !addForm.email.trim()) {
      setAddError('Укажите ФИО и email');
      return;
    }
    const emailNorm = addForm.email.trim().toLowerCase();
    if (employees.some(emp => emp.email.trim().toLowerCase() === emailNorm)) {
      setAddError('Сотрудник с таким email уже есть в списке');
      return;
    }
    const newEmployee = {
      id: makeEmployeeId(),
      name: addForm.name.trim(),
      email: addForm.email.trim(),
      managerEmail: addForm.managerEmail.trim(),
      department: addForm.department.trim(),
      track: addForm.track,
    };
    onSave([...employees, newEmployee], assignments);
    setAddForm(EMPTY_FORM);
    setAddError('');
    setShowAddForm(false);
  };

  const startEdit = (emp) => {
    setEditingId(emp.id);
    setEditForm({
      name: emp.name,
      email: emp.email,
      managerEmail: emp.managerEmail || '',
      department: emp.department || '',
      track: emp.track || DEFAULT_TRACK,
    });
  };

  const saveEdit = (empId) => {
    if (!editForm.name.trim() || !editForm.email.trim()) return;
    onSave(
      employees.map(emp => emp.id === empId ? {
        ...emp,
        name: editForm.name.trim(),
        email: editForm.email.trim(),
        managerEmail: editForm.managerEmail.trim(),
        department: editForm.department.trim(),
        track: editForm.track,
      } : emp),
      assignments
    );
    setEditingId(null);
  };

  // Track is a single-select property, same as the assignment-type dropdown
  // in the next step — editable directly in the row without entering full
  // edit mode.
  const handleTrackChange = (empId, track) => {
    onSave(employees.map(emp => emp.id === empId ? { ...emp, track } : emp), assignments);
  };

  const handleDelete = (emp) => {
    const confirmed = window.confirm('Удалить сотрудника? Его назначения тоже будут удалены.');
    if (!confirmed) return;
    const remainingEmployees = employees.filter(e => e.id !== emp.id);
    const remainingAssignments = assignments.filter(a => a.evalueeId !== emp.id && a.raterId !== emp.id);
    onSave(remainingEmployees, remainingAssignments);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => { setShowUpload(v => !v); setShowAddForm(false); }}
        >
          <Upload size={15} strokeWidth={2} />
          Загрузить из Excel
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => { setShowAddForm(v => !v); setShowUpload(false); }}
        >
          <Plus size={15} strokeWidth={2} />
          Добавить сотрудника
        </button>
      </div>

      {showUpload && (
        <div style={{ marginBottom: '1.5rem' }}>
          <AdminUpload onUpload={handleExcelUpload} onBack={() => setShowUpload(false)} />
        </div>
      )}

      {showAddForm && (
        <form
          onSubmit={handleAddSubmit}
          style={{ marginBottom: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', padding: '1.25rem', background: '#fff' }}
        >
          <h4 style={{ marginTop: 0 }}>Новый сотрудник</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>ФИО *</label>
              <input className="input" value={addForm.name} onChange={(e) => setAddForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Email *</label>
              <input className="input" type="email" value={addForm.email} onChange={(e) => setAddForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Email руководителя</label>
              <input className="input" type="email" value={addForm.managerEmail} onChange={(e) => setAddForm(f => ({ ...f, managerEmail: e.target.value }))} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Отдел</label>
              <input className="input" value={addForm.department} onChange={(e) => setAddForm(f => ({ ...f, department: e.target.value }))} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Трек</label>
              <TrackSelect value={addForm.track} onChange={(track) => setAddForm(f => ({ ...f, track }))} style={{ padding: '0.8rem 1rem', fontSize: '0.95rem' }} />
            </div>
          </div>

          {addError && <div className="error-message" style={{ marginTop: '1rem' }}>{addError}</div>}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button type="submit" className="btn btn-primary btn-sm">Сохранить</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setShowAddForm(false); setAddError(''); }}>
              Отмена
            </button>
          </div>
        </form>
      )}

      {employees.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>
          Сотрудников пока нет — загрузите список из Excel или добавьте вручную.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                <th style={thStyle}>ФИО</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Email руководителя</th>
                <th style={thStyle}>Отдел</th>
                <th style={thStyle}>Трек</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => {
                const isEditing = editingId === emp.id;
                return (
                  <tr key={emp.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {isEditing ? (
                      <>
                        <td style={tdStyle}>
                          <input className="input" style={inputSm} value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} />
                        </td>
                        <td style={tdStyle}>
                          <input className="input" style={inputSm} value={editForm.email} onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))} />
                        </td>
                        <td style={tdStyle}>
                          <input className="input" style={inputSm} value={editForm.managerEmail} onChange={(e) => setEditForm(f => ({ ...f, managerEmail: e.target.value }))} />
                        </td>
                        <td style={tdStyle}>
                          <input className="input" style={inputSm} value={editForm.department} onChange={(e) => setEditForm(f => ({ ...f, department: e.target.value }))} />
                        </td>
                        <td style={tdStyle}>
                          <TrackSelect value={editForm.track} onChange={(track) => setEditForm(f => ({ ...f, track }))} />
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button className="btn btn-icon btn-ghost" title="Сохранить" onClick={() => saveEdit(emp.id)}>
                              <Check size={15} strokeWidth={2} />
                            </button>
                            <button className="btn btn-icon btn-ghost" title="Отмена" onClick={() => setEditingId(null)}>
                              <X size={15} strokeWidth={2} />
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={tdStyle}>{emp.name}</td>
                        <td style={tdStyle}>{emp.email}</td>
                        <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{emp.managerEmail || '—'}</td>
                        <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{emp.department || '—'}</td>
                        <td style={tdStyle}>
                          <TrackSelect value={emp.track} onChange={(track) => handleTrackChange(emp.id, track)} />
                        </td>
                        <td style={tdStyle}>
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button className="btn btn-icon btn-ghost" title="Изменить" onClick={() => startEdit(emp)}>
                              <Pencil size={15} strokeWidth={2} />
                            </button>
                            <button className="btn btn-icon btn-danger-ghost" title="Удалить" onClick={() => handleDelete(emp)}>
                              <Trash2 size={15} strokeWidth={2} />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default EmployeesStep;
