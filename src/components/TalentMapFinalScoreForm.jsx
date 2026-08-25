import React, { useEffect, useRef, useState } from 'react';
import { Save, Info } from 'lucide-react';
import { getTalentResponse } from '../talentMap';
import { TALENT_COMPETENCIES, getAllTalentIndicatorIds } from '../talentCompetencies';
import {
  computeCompetencyAverages, computeOverallAverage, getGradeTarget, computeComplianceIndex, computeBand,
  isCeilingGrade, TALENT_BAND_LABELS, TALENT_BAND_STYLE, TALENT_BAND_EXCEEDS, DEFAULT_BAND_THRESHOLDS,
} from '../talentCompliance';

const LEVELS = [1, 2, 3, 4];
const ALL_INDICATOR_IDS = getAllTalentIndicatorIds();
const DEFAULT_OVERRIDE_NOTE = 'Решение калибровочного комитета';

function fmt(n) {
  return n !== null && n !== undefined ? n.toFixed(2).replace('.', ',') : '—';
}

function IndicatorField({ indicator, score, onScoreChange }) {
  return (
    <div className="talent-indicator">
      <h5>{indicator.name}</h5>
      {LEVELS.map(level => (
        <button
          key={level}
          type="button"
          className={`talent-level-option${score === level ? ' selected' : ''}`}
          onClick={() => onScoreChange(indicator.id, level)}
        >
          <span className="talent-level-num">{level}</span>
          <span className="talent-level-text">{indicator.levels[level - 1]}</span>
        </button>
      ))}
    </div>
  );
}

function MiniStat({ label, value, band }) {
  const style = band ? TALENT_BAND_STYLE[band] : null;
  return (
    <div style={{ padding: '0.9rem', background: 'var(--color-surface-tint)', borderRadius: 'var(--radius-btn)', textAlign: 'center' }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '0.3rem' }}>{label}</div>
      <div style={{ fontSize: '1.1rem', fontWeight: 700, color: style ? style.color : 'var(--color-primary)' }}>{value}</div>
    </div>
  );
}

// Форма ввода согласованных (финальных) баллов для одного оцениваемого —
// открывается из TalentMapFinalScoresStep.jsx. Предзаполняется оценкой
// руководителя (talentMaps/{ownerUid}/responses/manager_...) как отправной
// точкой при первом открытии; если баллы уже сохранялись, предзаполняется
// именно ими, а не заново оценкой руководителя. Индекс соответствия и
// полоса оси X считаются детерминированно в src/talentCompliance.js — AI
// в этот расчёт не вовлечён.
function TalentMapFinalScoreForm({ pairInfo, ownerUid, gradeTargets, bandThresholds, existingAssessment, onSave }) {
  const thresholds = bandThresholds || DEFAULT_BAND_THRESHOLDS;
  const { evaluee, manager, managerTask } = pairInfo;
  const [managerResponse, setManagerResponse] = useState(undefined);
  const [scores, setScores] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);
  const [overrideChecked, setOverrideChecked] = useState(!!existingAssessment?.manualOverrideBand);
  const [overrideNote, setOverrideNote] = useState(existingAssessment?.manualOverrideNote || DEFAULT_OVERRIDE_NOTE);
  const initializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setManagerResponse(undefined);
    getTalentResponse(ownerUid, managerTask.id)
      .then(r => { if (!cancelled) setManagerResponse(r); })
      .catch(err => {
        console.error('[TalentMapFinalScoreForm] Failed to load manager response:', err);
        if (!cancelled) setManagerResponse(null);
      });
    return () => { cancelled = true; };
  }, [ownerUid, managerTask.id]);

  useEffect(() => {
    if (managerResponse === undefined || initializedRef.current) return;
    initializedRef.current = true;
    setScores(existingAssessment?.scores || managerResponse?.scores || {});
  }, [managerResponse, existingAssessment]);

  const targetScore = getGradeTarget(gradeTargets, evaluee.grade);
  const ceiling = isCeilingGrade(gradeTargets, targetScore);

  const handleScoreChange = (indicatorId, level) => {
    setSaved(false);
    setScores(prev => ({ ...(prev || {}), [indicatorId]: level }));
  };

  const handleSave = async () => {
    const missing = ALL_INDICATOR_IDS.filter(id => ![1, 2, 3, 4].includes(scores?.[id]));
    if (missing.length > 0) {
      setSaveError(`Заполните все индикаторы — осталось ${missing.length}.`);
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const competencyAverages = computeCompetencyAverages(scores);
      const overallAverage = computeOverallAverage(competencyAverages);
      const complianceIndex = computeComplianceIndex(overallAverage, targetScore);
      const band = computeBand(complianceIndex, thresholds);

      await onSave(evaluee.id, {
        scores,
        competencyAverages,
        overallAverage,
        grade: evaluee.grade || null,
        targetScore,
        complianceIndex,
        band,
        manualOverrideBand: overrideChecked ? TALENT_BAND_EXCEEDS : null,
        manualOverrideNote: overrideChecked ? (overrideNote.trim() || DEFAULT_OVERRIDE_NOTE) : null,
      });
      setSaved(true);
    } catch (err) {
      console.error('[TalentMapFinalScoreForm] Failed to save final scores:', err);
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (scores === null) {
    return <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>;
  }

  const competencyAverages = computeCompetencyAverages(scores);
  const overallAverage = computeOverallAverage(competencyAverages);
  const complianceIndex = computeComplianceIndex(overallAverage, targetScore);
  const band = computeBand(complianceIndex, thresholds);
  const effectiveBand = overrideChecked ? TALENT_BAND_EXCEEDS : band;

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0 }}>{evaluee.fio}</h3>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', margin: '0.25rem 0 0' }}>
          Руководитель: {manager.fio} · Грейд: {evaluee.grade || '—'}
        </p>
      </div>

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: '0.6rem', padding: '0.9rem 1.1rem',
        background: 'var(--color-surface-tint)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
        marginBottom: '1.5rem', fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.5,
      }}>
        <Info size={16} strokeWidth={2} style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: '0.1rem' }} />
        <div>
          Поля предзаполнены оценкой руководителя как отправная точка. Поправьте баллы на те, к которым пришли на
          интервью руководитель–сотрудник, и сохраните — это и будут финальные, согласованные баллы.
        </div>
      </div>

      {TALENT_COMPETENCIES.map(comp => (
        <div key={comp.id} style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '0.25rem' }}>{comp.name}</h3>
          {comp.indicators.map(indicator => (
            <IndicatorField
              key={indicator.id}
              indicator={indicator}
              score={scores[indicator.id]}
              onScoreChange={handleScoreChange}
            />
          ))}
        </div>
      ))}

      <div style={{
        padding: '1.25rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
        background: '#fff', marginBottom: '1.5rem',
      }}>
        <h4 style={{ marginTop: 0 }}>Расчёт индекса соответствия</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: ceiling ? '1rem' : 0 }}>
          <MiniStat label="Средний балл" value={fmt(overallAverage)} />
          <MiniStat label="Целевой балл" value={targetScore !== null ? fmt(targetScore) : 'не задан'} />
          <MiniStat label="Индекс соответствия" value={complianceIndex !== null ? `${complianceIndex}%` : '—'} />
          <MiniStat label="Полоса X" value={effectiveBand ? TALENT_BAND_LABELS[effectiveBand] : '—'} band={effectiveBand} />
        </div>

        {ceiling && (
          <div style={{
            padding: '0.85rem 1rem', borderRadius: '10px', background: '#FCEBD9', border: '1px solid rgba(226,145,71,0.4)',
            fontSize: '0.85rem', color: 'var(--color-text)', lineHeight: 1.5,
          }}>
            У этого грейда самый высокий целевой балл в таблице — формула почти никогда не даёт «Превосходит» (для
            этого средний балл должен быть выше 4, а шкала ограничена 4). Переход в «Превосходит» для такого грейда —
            решение калибровочного комитета, не формулы.
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={overrideChecked}
                onChange={(e) => { setOverrideChecked(e.target.checked); setSaved(false); }}
              />
              Присвоить итоговую полосу «Превосходит» решением комитета
            </label>
            {overrideChecked && (
              <input
                className="input"
                style={{ marginTop: '0.6rem' }}
                value={overrideNote}
                onChange={(e) => { setOverrideNote(e.target.value); setSaved(false); }}
                placeholder="Комментарий комитета (необязательно)"
              />
            )}
          </div>
        )}
      </div>

      {saveError && <div className="error-message">{saveError}</div>}
      {saved && <div className="info-message">Финальные баллы сохранены.</div>}

      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        <Save size={16} strokeWidth={2} />
        {saving ? 'Сохранение...' : 'Сохранить финальные баллы'}
      </button>
    </div>
  );
}

export default TalentMapFinalScoreForm;
