import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Paperclip, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { computeHierarchyDepths, suggestGradeByDepth } from '../talentGrades';
import { DEFAULT_BAND_THRESHOLDS, BAND_THRESHOLD_MIN, BAND_THRESHOLD_MAX, isValidBandThresholds } from '../talentCompliance';

const FIO_HEADERS = ['фио', 'фио сотрудника'];
const EMAIL_HEADERS = ['email сотрудника', 'email', 'почта'];
const MANAGER_EMAIL_HEADERS = ['email руководителя', 'почта руководителя'];
const GRADE_HEADERS = ['грейд', 'грейд сотрудника', 'уровень'];

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
  color: 'var(--color-text-muted)', textAlign: 'left',
};
const tdStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'middle', fontSize: '0.88rem' };
const inputSm = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', width: '100%' };

function findColumn(headers, candidates) {
  return headers.findIndex(h => candidates.includes(String(h ?? '').trim().toLowerCase()));
}

let idCounter = 0;
function makeTalentEmployeeId() {
  return `tmemp_${Date.now()}_${idCounter++}`;
}

// Разбирает лист Excel в список сотрудников карты талантов. Грейд не
// обязателен ни как колонка, ни как значение в строке — если его нет,
// каждому сотруднику подставляется подсказка по глубине в иерархии
// (computeHierarchyDepths/suggestGradeByDepth), а не выбрасывается ошибка.
function parseTalentWorkbookRows(rows) {
  if (rows.length < 2) {
    throw new Error('Нужен заголовок и хотя бы одна строка');
  }

  const headers = rows[0].map(h => (typeof h === 'string' ? h.trim() : h));
  const fioIdx = findColumn(headers, FIO_HEADERS);
  const emailIdx = findColumn(headers, EMAIL_HEADERS);
  const managerEmailIdx = findColumn(headers, MANAGER_EMAIL_HEADERS);
  const gradeIdx = findColumn(headers, GRADE_HEADERS);

  if (fioIdx === -1 || emailIdx === -1) {
    throw new Error('Нужны колонки «ФИО» и «Email сотрудника»');
  }

  const parsed = rows.slice(1)
    .filter(row => row[fioIdx] && row[emailIdx])
    .map(row => ({
      id: makeTalentEmployeeId(),
      fio: String(row[fioIdx]).trim(),
      email: String(row[emailIdx]).trim(),
      managerEmail: managerEmailIdx !== -1 && row[managerEmailIdx] ? String(row[managerEmailIdx]).trim() : '',
      gradeFromFile: gradeIdx !== -1 && row[gradeIdx] ? String(row[gradeIdx]).trim() : '',
    }));

  if (parsed.length === 0) {
    throw new Error('Не найдены сотрудники');
  }

  const depths = computeHierarchyDepths(parsed);

  return parsed.map(e => {
    if (e.gradeFromFile) {
      return { id: e.id, fio: e.fio, email: e.email, managerEmail: e.managerEmail, grade: e.gradeFromFile, gradeSource: 'file' };
    }
    const depth = depths.get(e.id) ?? 0;
    return { id: e.id, fio: e.fio, email: e.email, managerEmail: e.managerEmail, grade: suggestGradeByDepth(depth), gradeSource: 'suggested' };
  });
}

function GradeBadge({ gradeSource }) {
  if (gradeSource === 'file' || gradeSource === 'manual') return null;
  return (
    <span
      title="Грейд не задан явно — подставлена подсказка по глубине в иерархии. Поправьте вручную при необходимости."
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
        padding: '0.15rem 0.5rem', borderRadius: 999, marginLeft: '0.5rem',
        fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
        background: 'rgba(226, 145, 71, 0.14)', color: 'var(--color-accent-hover)',
      }}
    >
      <AlertTriangle size={11} strokeWidth={2} />
      Подсказка
    </span>
  );
}

// Шаг 1 «Загрузка»: разбор Excel, редактирование грейда по строке и
// таблица целевых баллов по грейдам. Изменения сохраняются сразу через
// переданные onSave*-колбэки (тот же паттерн, что и в EmployeesStep.jsx
// для опросов 360) — отдельного черновика/кнопки «Сохранить всё» нет.
function TalentMapUploadStep({ employees, gradeTargets, onSaveEmployees, onSaveGradeTargets, bandThresholds, onSaveBandThresholds }) {
  const [error, setError] = useState('');
  const [gradeDrafts, setGradeDrafts] = useState({});

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        const parsedEmployees = parseTalentWorkbookRows(rows);

        if (employees.length > 0) {
          const confirmed = window.confirm(
            `Заменить текущий список сотрудников (${employees.length}) новым из файла (${parsedEmployees.length})? Существующие данные карты талантов будут перезаписаны.`
          );
          if (!confirmed) return;
        }

        setError('');
        onSaveEmployees(parsedEmployees);
      } catch (err) {
        setError(err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const commitGrade = (empId) => {
    const draft = gradeDrafts[empId];
    setGradeDrafts(prev => {
      const next = { ...prev };
      delete next[empId];
      return next;
    });
    const trimmed = (draft ?? '').trim();
    if (!trimmed) return; // пустое значение игнорируем — грейд остаётся прежним

    const target = employees.find(emp => emp.id === empId);
    if (!target || trimmed === target.grade) return;
    onSaveEmployees(employees.map(emp => emp.id === empId ? { ...emp, grade: trimmed, gradeSource: 'manual' } : emp));
  };

  const missingCount = employees.filter(e => e.gradeSource !== 'file' && e.gradeSource !== 'manual').length;

  return (
    <div>
      <label className="upload-label">
        <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="file-input" />
        <span className="upload-button">
          <Paperclip size={16} strokeWidth={2} />
          Загрузить Excel
        </span>
      </label>

      <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.75rem', lineHeight: 1.5 }}>
        Нужные колонки: <strong>ФИО</strong>, <strong>Email сотрудника</strong> (уникальный идентификатор),{' '}
        <strong>Email руководителя</strong> (пусто у самого верхнего), опционально — <strong>Грейд</strong>{' '}
        (СЕО-1…СЕО-5). Если грейда нет или он пуст — подставим подсказку по глубине в иерархии, поправить можно вручную ниже.
      </div>

      {error && <div className="error-message" style={{ marginTop: '1rem' }}>{error}</div>}

      {employees.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', marginTop: '1.5rem' }}>
          Сотрудников пока нет — загрузите список из Excel.
        </p>
      ) : (
        <div style={{ marginTop: '1.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <h4 style={{ margin: 0 }}>Сотрудники ({employees.length})</h4>
            {missingCount > 0 && (
              <span style={{ fontSize: '0.85rem', color: 'var(--color-accent-hover)' }}>
                Без явно заданного грейда: {missingCount}
              </span>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
                  <th style={thStyle}>ФИО</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Email руководителя</th>
                  <th style={thStyle}>Грейд</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr
                    key={emp.id}
                    style={{
                      borderBottom: '1px solid var(--color-border)',
                      background: emp.gradeSource === 'suggested' ? 'rgba(226, 145, 71, 0.05)' : 'transparent',
                    }}
                  >
                    <td style={tdStyle}>{emp.fio}</td>
                    <td style={tdStyle}>{emp.email}</td>
                    <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{emp.managerEmail || '—'}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <input
                          className="input"
                          style={{ ...inputSm, width: '110px' }}
                          value={gradeDrafts[emp.id] ?? emp.grade ?? ''}
                          onChange={(e) => setGradeDrafts(prev => ({ ...prev, [emp.id]: e.target.value }))}
                          onBlur={() => commitGrade(emp.id)}
                        />
                        <GradeBadge gradeSource={emp.gradeSource} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 360px', minWidth: '320px' }}>
          <GradeTargetsEditor gradeTargets={gradeTargets} onSave={onSaveGradeTargets} />
        </div>
        <div style={{ flex: '1 1 320px', minWidth: '280px' }}>
          <BandThresholdsEditor bandThresholds={bandThresholds} onSave={onSaveBandThresholds} />
        </div>
      </div>
    </div>
  );
}

// Редактируемая таблица «грейд → целевой средний балл». Сам расчёт индекса
// соответствия — следующая фаза; здесь только хранение и редактирование.
function GradeTargetsEditor({ gradeTargets, onSave }) {
  const [rows, setRows] = useState(gradeTargets);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRows(gradeTargets);
  }, [gradeTargets]);

  const updateRow = (idx, field, value) => {
    setSaved(false);
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const addRow = () => {
    setSaved(false);
    setRows(prev => [...prev, { grade: '', target: '' }]);
  };

  const removeRow = (idx) => {
    setSaved(false);
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = () => {
    const cleaned = rows
      .map(r => ({ grade: String(r.grade).trim(), target: Number(r.target) }))
      .filter(r => r.grade && !Number.isNaN(r.target));
    setRows(cleaned);
    onSave(cleaned);
    setSaved(true);
  };

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', padding: '1.25rem', background: '#fff' }}>
      <h4 style={{ marginTop: 0 }}>Таблица грейдов и целевых баллов</h4>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Целевой средний балл по индикаторам для каждого грейда. Расчёт индекса соответствия — на следующем этапе.
      </p>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={thStyle}>Грейд</th>
              <th style={thStyle}>Целевой балл (1–4)</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={tdStyle}>
                  <input className="input" style={{ ...inputSm, width: '140px' }} value={row.grade} onChange={(e) => updateRow(idx, 'grade', e.target.value)} />
                </td>
                <td style={tdStyle}>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="1"
                    max="4"
                    style={{ ...inputSm, width: '100px' }}
                    value={row.target}
                    onChange={(e) => updateRow(idx, 'target', e.target.value)}
                  />
                </td>
                <td style={tdStyle}>
                  <button className="btn btn-icon btn-danger-ghost" title="Удалить грейд" onClick={() => removeRow(idx)}>
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={addRow}>
          <Plus size={15} strokeWidth={2} />
          Добавить грейд
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>
          Сохранить таблицу
        </button>
        {saved && <span style={{ color: 'var(--color-success)', fontSize: '0.85rem', fontWeight: 500 }}>Сохранено</span>}
      </div>
    </div>
  );
}

// Настраиваемые пороги коридора «Соответствует» для индекса соответствия
// (Фаза 4: src/talentCompliance.js — расчёт полностью детерминированный,
// эти два числа только параметризуют пороги, ничего не считают сами).
// Меняя их здесь, суперадмин сразу пересчитывает полосу оси X у всех уже
// внесённых финальных баллов — getEffectiveBand() всегда читает текущие
// пороги, а не то, что было сохранено на момент ввода баллов.
function BandThresholdsEditor({ bandThresholds, onSave }) {
  const initial = bandThresholds || DEFAULT_BAND_THRESHOLDS;
  const [lower, setLower] = useState(String(initial.lower));
  const [upper, setUpper] = useState(String(initial.upper));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const next = bandThresholds || DEFAULT_BAND_THRESHOLDS;
    setLower(String(next.lower));
    setUpper(String(next.upper));
  }, [bandThresholds]);

  const handleSave = () => {
    const next = { lower: Number(lower), upper: Number(upper) };
    if (!isValidBandThresholds(next)) {
      setSaved(false);
      setError(
        `Нижний порог должен быть меньше верхнего, оба — в пределах ${BAND_THRESHOLD_MIN}–${BAND_THRESHOLD_MAX}%.`
      );
      return;
    }
    setError('');
    onSave(next);
    setSaved(true);
  };

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', padding: '1.25rem', background: '#fff' }}>
      <h4 style={{ marginTop: 0 }}>Пороги индекса соответствия</h4>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Коридор «Соответствует»: от нижнего до верхнего порога. Ниже — не соответствует, выше — превосходит.
      </p>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div className="form-group" style={{ marginBottom: 0, flex: '1 1 140px' }}>
          <label>Нижний порог (%)</label>
          <input
            className="input"
            type="number"
            step="1"
            min={BAND_THRESHOLD_MIN}
            max={BAND_THRESHOLD_MAX}
            style={inputSm}
            value={lower}
            onChange={(e) => { setLower(e.target.value); setSaved(false); }}
          />
        </div>
        <div className="form-group" style={{ marginBottom: 0, flex: '1 1 140px' }}>
          <label>Верхний порог (%)</label>
          <input
            className="input"
            type="number"
            step="1"
            min={BAND_THRESHOLD_MIN}
            max={BAND_THRESHOLD_MAX}
            style={inputSm}
            value={upper}
            onChange={(e) => { setUpper(e.target.value); setSaved(false); }}
          />
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>
          Сохранить пороги
        </button>
        {saved && <span style={{ color: 'var(--color-success)', fontSize: '0.85rem', fontWeight: 500 }}>Сохранено</span>}
      </div>
    </div>
  );
}

export default TalentMapUploadStep;
