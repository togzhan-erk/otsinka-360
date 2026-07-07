import React, { useState } from 'react';
import * as XLSX from 'xlsx';

function AdminUpload({ onUpload }) {
  const [employees, setEmployees] = useState([]);
  const [showTable, setShowTable] = useState(false);
  const [error, setError] = useState('');

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
        const fioIdx = headers.findIndex(h => h.toLowerCase() === 'фио');
        const emailIdx = headers.findIndex(h => h.toLowerCase() === 'почта');

        if (fioIdx === -1 || emailIdx === -1) {
          setError('Нужны колонки "ФИО" и "Почта"');
          return;
        }

        const newEmployees = rows.slice(1)
          .filter(row => row[fioIdx] && row[emailIdx])
          .map((row, idx) => ({
            id: `emp_${idx}`,
            name: String(row[fioIdx]).trim(),
            email: String(row[emailIdx]).trim()
          }));

        if (newEmployees.length === 0) {
          setError('Не найдены сотрудники');
          return;
        }

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
        <h2>Загрузка сотрудников</h2>
        <p className="subtitle">Загрузите Excel файл со списком</p>

        <label className="upload-label">
          <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="file-input" />
          <span className="upload-button">📎 Выбрать файл</span>
        </label>

        {error && <div className="error-message">{error}</div>}

        {showTable && employees.length > 0 && (
          <div>
            <h3>Загруженные ({employees.length})</h3>
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