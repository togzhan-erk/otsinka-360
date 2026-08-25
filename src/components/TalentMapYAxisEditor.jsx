import React, { useState } from 'react';
import {
  TALENT_BAND_LABELS, TALENT_BAND_BELOW, TALENT_BAND_MATCH, TALENT_BAND_EXCEEDS,
} from '../talentCompliance';
import { computeEffectiveYBand } from '../talentNineBox';

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
  color: 'var(--color-text-muted)', textAlign: 'left',
};
const tdStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'middle', fontSize: '0.88rem' };
const inputSm = { padding: '0.4rem 0.6rem', fontSize: '0.85rem', width: '100%' };

// Ось Y — KPI, вносится вручную по каждому оцениваемому (Фаза 5a). Если
// задан KPI% — эффективная полоса Y считается по тем же настраиваемым
// порогам, что и ось X (src/talentNineBox.js: computeEffectiveYBand); если
// KPI% пуст, используется вручную выбранная полоса. Оба поля сохраняются
// сразу при изменении — dropdown по onChange, KPI% по blur (тот же приём,
// что редактирование грейда в TalentMapUploadStep.jsx).
function TalentMapYAxisEditor({ pairs, bandThresholds, yAxisAssessments, onSave }) {
  const [kpiDrafts, setKpiDrafts] = useState({});

  const handleManualBandChange = (evalueeId, manualBand) => {
    const existing = yAxisAssessments?.[evalueeId] || {};
    onSave(evalueeId, { manualBand: manualBand || null, kpiPercent: existing.kpiPercent ?? null });
  };

  const commitKpi = (evalueeId) => {
    const draft = kpiDrafts[evalueeId];
    if (draft === undefined) return;
    setKpiDrafts(prev => {
      const next = { ...prev };
      delete next[evalueeId];
      return next;
    });
    const trimmed = draft.trim();
    const kpiPercent = trimmed === '' ? null : Number(trimmed);
    if (trimmed !== '' && Number.isNaN(kpiPercent)) return; // некорректное число — игнорируем правку

    const existing = yAxisAssessments?.[evalueeId] || {};
    onSave(evalueeId, { manualBand: existing.manualBand ?? null, kpiPercent });
  };

  if (pairs.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)' }}>
        Пар пока нет — они появляются для сотрудников, у которых в загруженном списке задан руководитель.
      </p>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
            <th style={thStyle}>ФИО</th>
            <th style={thStyle}>Полоса X</th>
            <th style={thStyle}>Полоса Y (вручную)</th>
            <th style={thStyle}>KPI, % плана</th>
            <th style={thStyle}>Эффективная Y</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map(p => {
            const yAssessment = yAxisAssessments?.[p.evalueeId] || null;
            const effectiveY = computeEffectiveYBand(yAssessment, bandThresholds);
            const kpiValue = kpiDrafts[p.evalueeId] ?? (yAssessment?.kpiPercent ?? '');
            return (
              <tr key={p.evalueeId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={tdStyle}>{p.evaluee.fio}</td>
                <td style={{ ...tdStyle, color: 'var(--color-text-muted)' }}>
                  {p.xBand ? TALENT_BAND_LABELS[p.xBand] : '—'}
                </td>
                <td style={tdStyle}>
                  <select
                    className="input"
                    style={{ ...inputSm, width: '170px' }}
                    value={yAssessment?.manualBand || ''}
                    onChange={(e) => handleManualBandChange(p.evalueeId, e.target.value || null)}
                  >
                    <option value="">не задано</option>
                    <option value={TALENT_BAND_BELOW}>{TALENT_BAND_LABELS[TALENT_BAND_BELOW]}</option>
                    <option value={TALENT_BAND_MATCH}>{TALENT_BAND_LABELS[TALENT_BAND_MATCH]}</option>
                    <option value={TALENT_BAND_EXCEEDS}>{TALENT_BAND_LABELS[TALENT_BAND_EXCEEDS]}</option>
                  </select>
                </td>
                <td style={tdStyle}>
                  <input
                    className="input"
                    type="number"
                    style={{ ...inputSm, width: '100px' }}
                    value={kpiValue}
                    onChange={(e) => setKpiDrafts(prev => ({ ...prev, [p.evalueeId]: e.target.value }))}
                    onBlur={() => commitKpi(p.evalueeId)}
                  />
                </td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>
                  {effectiveY ? TALENT_BAND_LABELS[effectiveY] : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default TalentMapYAxisEditor;
