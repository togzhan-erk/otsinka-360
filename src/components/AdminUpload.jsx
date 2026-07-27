import React, { useState } from 'react';
import * as XLSX from 'xlsx';

const FIO_HEADERS = ['фио', 'фио сотрудника'];
const EMAIL_HEADERS = ['email сотрудника', 'email', 'почта'];
const MANAGER_EMAIL_HEADERS = ['email руководителя', 'почта руководителя'];
const DEPARTMENT_HEADERS = ['отдел', 'подразделение', 'отдел/подразделение'];

function findColumn(headers, candidates) {
  return headers.findIndex(h => candidates.includes(String(h ?? '').trim().toLowerCase()));
}

function BackButton({ onBack }) {
  if (!onBack) return null;
  return (
    <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#6f6f77', cursor: 'pointer', fontSize: '0.95rem', padding: 0, marginBottom: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
      ← Назад
    </button>
  );
}

function AdminUpload({ onUpload, onBack }) {
  const [employees, setEmployees] = useState([]);
  const [showTable, setShowTable] = useState(false);
  const [error, setError] = useState('');
  const [autoAssignNote, setAutoAssignNote] = useState('');

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (rows.length < 2) {
          setError('Нужен заголовок и хотя бы одна строка');
          return;
        }

        const headers = rows[0].map(h => typeof h === 'string' ? h.trim() : h);
        const fioIdx = findColumn(headers, FIO_HEADERS);
        const emailIdx = findColumn(headers, EMAIL_HEADERS);
        const managerEmailIdx = findColumn(headers, MANAGER_EMAIL_HEADERS);
        const departmentIdx = findColumn(headers, DEPARTMENT_HEADERS);

        if (fioIdx === -1 || emailIdx === -1) {
          setError('Нужны колонки "ФИО" и "Email сотрудника"');
          return;
        }

        const newEmployees = rows.slice(1)
          .filter(row => row[fioIdx] && row[emailIdx])
          .map((row, idx) => {
            const emp = {
              id: `emp_${idx}`,
              name: String(row[fioIdx]).trim(),
              email: String(row[emailIdx]).trim(),
            };
            if (managerEmailIdx !== -1) {
              emp.managerEmail = row[managerEmailIdx] ? String(row[managerEmailIdx]).trim() : '';
            }
            if (departmentIdx !== -1) {
              emp.department = row[departmentIdx] ? String(row[departmentIdx]).trim() : '';
            }
            return emp;
          });

        if (newEmployees.length === 0) {
          setError('Не найдены сотрудники');
          return;
        }

        setAutoAssignNote(
          managerEmailIdx === -1
            ? 'В файле нет колонки «Email руководителя» — автоматическое назначение оценивающих на следующем шаге будет недоступно, но вы сможете назначить их вручную, как раньше.'
            : ''
        );
        setEmployees(newEmployees);
        setShowTable(true);
        setError('');
      } catch (err) {
        setError('Ошибка: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="container">
      <div className="card">
        <BackButton onBack={onBack} />
        <h2>Загрузка сотрудников</h2>
        <p className="subtitle">Загрузите Excel файл со списком</p>

        <label className="upload-label">
          <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="file-input" />
          <span className="upload-button">📎 Выбрать файл</span>
        </label>

        <div style={{ fontSize: '0.85rem', color: '#6f6f77', marginTop: '0.75rem', lineHeight: 1.5 }}>
          Нужные колонки: <strong>ФИО</strong>, <strong>Email сотрудника</strong> (уникальный),{' '}
          <strong>Email руководителя</strong> (для автоматического назначения оценивающих), опционально —{' '}
          <strong>Отдел/подразделение</strong>.
        </div>

        {error && <div className="error-message">{error}</div>}

        {showTable && employees.length > 0 && (
          <div>
            <h3>Загруженные ({employees.length})</h3>
            {autoAssignNote && (
              <div style={{
                padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem',
                background: '#fff8e6', border: '1px solid #f0d585', color: '#7a5c00', fontSize: '0.9rem',
              }}>
                {autoAssignNote}
              </div>
            )}
            <ul>
              {employees.map(emp => (
                <li key={emp.id}>{emp.name} - {emp.email}</li>
              ))}
            </ul>
            <button onClick={() => onUpload(employees)} className="btn btn-success">
              Далее →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminUpload;
