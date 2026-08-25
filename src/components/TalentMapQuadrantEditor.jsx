import React, { useState, useEffect } from 'react';
import { RotateCcw } from 'lucide-react';
import { TALENT_BAND_LABELS } from '../talentCompliance';
import {
  Y_AXIS_ORDER, X_AXIS_ORDER, quadrantKey, getQuadrant,
  ZONE_OPTIONS, ZONE_LABELS, POOL_ORDER, POOL_NONE, POOL_LABELS,
} from '../talentNineBox';

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
  color: 'var(--color-text-muted)', textAlign: 'left',
};
const tdStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'top', fontSize: '0.85rem' };
const inputSm = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', width: '100%' };

function buildRows(quadrants) {
  const result = {};
  Y_AXIS_ORDER.forEach(yBand => X_AXIS_ORDER.forEach(xBand => {
    const key = quadrantKey(yBand, xBand);
    result[key] = { ...getQuadrant(quadrants, yBand, xBand) };
  }));
  return result;
}

// Настройка всех 9 ячеек карты — название, зона (цвет), пул, рекомендованное
// действие. Сохраняется целиком одним вызовом (та же логика, что таблица
// целевых баллов по грейдам в TalentMapUploadStep.jsx: локальный черновик,
// кнопка «Сохранить», без автосохранения по полю). «Сбросить к значениям по
// умолчанию» возвращает исходные 9 формулировок из задачи Фазы 5a, не
// удаляя ничего в Firestore, пока не нажата «Сохранить».
function TalentMapQuadrantEditor({ quadrants, onSave }) {
  const [rows, setRows] = useState(() => buildRows(quadrants));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRows(buildRows(quadrants));
  }, [quadrants]);

  const updateCell = (key, field, value) => {
    setSaved(false);
    setRows(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const handleSave = () => {
    onSave(rows);
    setSaved(true);
  };

  const handleResetDefaults = () => {
    setSaved(false);
    setRows(buildRows({}));
  };

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', padding: '1.25rem', background: '#fff', marginTop: '1.5rem' }}>
      <h4 style={{ marginTop: 0 }}>Настройка ячеек</h4>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
        Название, зона, пул и рекомендованное действие для каждой из 9 ячеек карты.
      </p>

      <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={thStyle}>Y</th>
              <th style={thStyle}>X</th>
              <th style={{ ...thStyle, minWidth: '160px' }}>Название</th>
              <th style={thStyle}>Зона</th>
              <th style={{ ...thStyle, minWidth: '180px' }}>Пул</th>
              <th style={{ ...thStyle, minWidth: '260px' }}>Рекомендованное действие</th>
            </tr>
          </thead>
          <tbody>
            {Y_AXIS_ORDER.map(yBand => X_AXIS_ORDER.map(xBand => {
              const key = quadrantKey(yBand, xBand);
              const row = rows[key];
              return (
                <tr key={key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{TALENT_BAND_LABELS[yBand]}</td>
                  <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>{TALENT_BAND_LABELS[xBand]}</td>
                  <td style={tdStyle}>
                    <input className="input" style={inputSm} value={row.name} onChange={(e) => updateCell(key, 'name', e.target.value)} />
                  </td>
                  <td style={tdStyle}>
                    <select className="input" style={inputSm} value={row.zone} onChange={(e) => updateCell(key, 'zone', e.target.value)}>
                      {ZONE_OPTIONS.map(z => <option key={z} value={z}>{ZONE_LABELS[z]}</option>)}
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <select className="input" style={inputSm} value={row.pool} onChange={(e) => updateCell(key, 'pool', e.target.value)}>
                      <option value={POOL_NONE}>{POOL_LABELS[POOL_NONE]}</option>
                      {POOL_ORDER.map(p => <option key={p} value={p}>{POOL_LABELS[p]}</option>)}
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <textarea
                      className="textarea"
                      style={{ ...inputSm, minHeight: '54px' }}
                      value={row.action}
                      onChange={(e) => updateCell(key, 'action', e.target.value)}
                    />
                  </td>
                </tr>
              );
            }))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn btn-primary btn-sm" onClick={handleSave}>Сохранить ячейки</button>
        <button className="btn btn-ghost btn-sm" onClick={handleResetDefaults}>
          <RotateCcw size={14} strokeWidth={2} />
          Сбросить к значениям по умолчанию
        </button>
        {saved && <span style={{ color: 'var(--color-success)', fontSize: '0.85rem', fontWeight: 500 }}>Сохранено</span>}
      </div>
    </div>
  );
}

export default TalentMapQuadrantEditor;
