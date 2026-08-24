import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import { getAllTalentIndicatorIds } from '../talentCompetencies';

const LEVELS = [1, 2, 3, 4];
const AUTOSAVE_DELAY_MS = 1500;
const ALL_INDICATOR_IDS = getAllTalentIndicatorIds();

function IndicatorField({ indicator, score, example, onScoreChange, onExampleChange, showError }) {
  const isExtreme = score === 1 || score === 4;
  const missingExample = isExtreme && showError && !String(example || '').trim();

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
      {isExtreme && (
        <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
          <label>Приведите короткий пример *</label>
          <textarea
            className="textarea"
            rows="2"
            value={example || ''}
            onChange={(e) => onExampleChange(indicator.id, e.target.value)}
            placeholder="Опишите конкретную ситуацию..."
          />
          {missingExample && (
            <div style={{ color: 'var(--color-danger)', fontSize: '0.8rem', marginTop: '0.35rem' }}>
              Пример обязателен для крайней оценки
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Открывается только из TalentTaskList по клику на задачу — token/taskId
// уже проверены сервером в api/talent-task-form.mjs (ownership повторно
// проверяется и на каждом сохранении в api/talent-task-save.mjs), так что
// этому компоненту не нужно самому решать, можно ли сюда попасть.
//
// Прогресс сохраняется автоматически (debounced autosave при любом
// изменении) плюс явной кнопкой «Сохранить черновик» — то и другое шлёт
// finalize:false, поэтому черновик можно сохранить не заполнив форму
// целиком. «Завершить оценку» проверяет на клиенте то же, что и сервер
// (все 28 индикаторов оценены, у каждой крайней оценки есть пример) —
// клиентская проверка только для быстрой обратной связи, финальное решение
// всегда за сервером.
function TalentAssessmentForm({ token, taskId, evalueeName, type, competencies, initialScores, initialExamples, onBack, onCompleted }) {
  const [scores, setScores] = useState(initialScores || {});
  const [examples, setExamples] = useState(initialExamples || {});
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showValidation, setShowValidation] = useState(false);
  const autosaveTimer = useRef(null);
  const isFirstRender = useRef(true);

  const saveDraft = useCallback(async (nextScores, nextExamples) => {
    setSaveState('saving');
    try {
      const res = await fetch('/api/talent-task-save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, taskId, scores: nextScores, examples: nextExamples, finalize: false }),
      });
      if (!res.ok) throw new Error('save failed');
      setSaveState('saved');
    } catch (err) {
      console.error('[TalentAssessmentForm] Autosave failed:', err);
      setSaveState('error');
    }
  }, [token, taskId]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      saveDraft(scores, examples);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [scores, examples, saveDraft]);

  const handleScoreChange = (indicatorId, level) => {
    setScores(prev => ({ ...prev, [indicatorId]: level }));
  };

  const handleExampleChange = (indicatorId, value) => {
    setExamples(prev => ({ ...prev, [indicatorId]: value }));
  };

  const handleSaveDraftClick = () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    saveDraft(scores, examples);
  };

  const missingScores = ALL_INDICATOR_IDS.filter(id => ![1, 2, 3, 4].includes(scores[id]));
  const missingExamples = ALL_INDICATOR_IDS.filter(id => {
    const v = scores[id];
    return (v === 1 || v === 4) && !String(examples[id] || '').trim();
  });

  const handleSubmit = async () => {
    if (missingScores.length > 0 || missingExamples.length > 0) {
      setShowValidation(true);
      setSubmitError(
        missingScores.length > 0
          ? `Заполните все пункты — осталось ${missingScores.length}.`
          : `Добавьте пример для крайних оценок — осталось ${missingExamples.length}.`
      );
      return;
    }

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch('/api/talent-task-save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, taskId, scores, examples, finalize: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Не удалось сохранить оценку. Попробуйте ещё раз.');
      }
      onCompleted();
    } catch (err) {
      console.error('[TalentAssessmentForm] Submit error:', err);
      setSubmitError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: '760px' }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer',
              fontSize: '0.9rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500, padding: 0,
              marginBottom: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
            }}
          >
            <ArrowLeft size={16} strokeWidth={2} />
            К списку задач
          </button>
        )}

        <h2>Оценка компетенций</h2>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          Добрый день! Вы оцениваете {type === 'self' ? 'свою работу' : <strong>{evalueeName}</strong>}. Оценивайте
          по описанию уровня, которое лучше всего соответствует реальному поведению за последние 6 месяцев, а не
          общему впечатлению. По каждому пункту выберите уровень от 1 до 4.
        </p>

        {competencies.map(comp => (
          <div key={comp.id} style={{ marginBottom: '2rem' }}>
            <h3 style={{ marginBottom: '0.25rem' }}>{comp.name}</h3>
            {comp.indicators.map(indicator => (
              <IndicatorField
                key={indicator.id}
                indicator={indicator}
                score={scores[indicator.id]}
                example={examples[indicator.id]}
                onScoreChange={handleScoreChange}
                onExampleChange={handleExampleChange}
                showError={showValidation}
              />
            ))}
          </div>
        ))}

        {submitError && <div className="error-message">{submitError}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={handleSaveDraftClick} disabled={saveState === 'saving'}>
            {saveState === 'saving' ? 'Сохранение...' : 'Сохранить черновик'}
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            <Check size={16} strokeWidth={2} />
            {submitting ? 'Сохранение...' : 'Завершить оценку'}
          </button>
          {saveState === 'saved' && <span style={{ color: 'var(--color-success)', fontSize: '0.85rem' }}>Черновик сохранён</span>}
          {saveState === 'error' && <span style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>Ошибка автосохранения</span>}
        </div>
      </div>
    </div>
  );
}

export default TalentAssessmentForm;
