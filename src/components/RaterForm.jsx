import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

const DEFAULT_OPEN_QUESTIONS = {
  strength: 'Что делает хорошо?',
  improvement: 'Что развивать?',
};

// Always reached via a personal invite link (cycleId + assignmentId) — the
// only way anyone gets here, resolved server-side by api/rater-form. This
// form never talks to Firestore directly; it only ever posts to
// api/submit-feedback.
function RaterForm({ evaluee, competencies, onSubmit, onBack, cycleId, assignmentId, openQuestionLabels }) {
  const labels = openQuestionLabels || DEFAULT_OPEN_QUESTIONS;
  const [scores, setScores] = useState(
    competencies.reduce((acc, comp) => ({ ...acc, [comp.id]: 3 }), {})
  );
  const [strength, setStrength] = useState('');
  const [improvement, setImprovement] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleScoreChange = (compId, value) => {
    setScores({ ...scores, [compId]: parseInt(value) || 3 });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!strength.trim() || !improvement.trim()) {
      setError('Пожалуйста, ответьте на оба вопроса');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      console.log('[RaterForm] Submitting via api/submit-feedback for cycle', cycleId, 'assignment', assignmentId);
      const res = await fetch('/api/submit-feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cycleId,
          assignmentId,
          competencyScores: scores,
          openQuestions: { strength, improvement },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Не удалось сохранить ответ. Попробуйте ещё раз.');
      }
      onSubmit({ competencyScores: scores, openQuestions: { strength, improvement } });
    } catch (err) {
      console.error('[RaterForm] Submit error:', err);
      setError(err.message || 'Ошибка сохранения');
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        {onBack && (
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.9rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500, padding: 0, marginBottom: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <ArrowLeft size={16} strokeWidth={2} />
            Назад
          </button>
        )}
        <h2>Оценка компетенций</h2>
        <p className="subtitle">Оцените {evaluee?.name}</p>

        <form onSubmit={handleSubmit}>
          <div className="competencies-evaluation">
            <h3>Компетенции (1-5)</h3>
            {competencies.map(comp => (
              <div key={comp.id} className="competency-row">
                <div className="competency-info">
                  <h4>{comp.name}</h4>
                  <p className="competency-question">{comp.question}</p>
                </div>
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={scores[comp.id]}
                  onChange={(e) => handleScoreChange(comp.id, e.target.value)}
                  className="score-number-input"
                />
              </div>
            ))}
          </div>

          <div className="open-questions">
            <h3>Открытые вопросы</h3>

            <div className="form-group">
              <label><strong>{labels.strength}</strong> *</label>
              <textarea
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder="Опишите..."
                className="textarea"
                rows="4"
              />
            </div>

            <div className="form-group">
              <label><strong>{labels.improvement}</strong> *</label>
              <textarea
                value={improvement}
                onChange={(e) => setImprovement(e.target.value)}
                placeholder="Опишите..."
                className="textarea"
                rows="4"
              />
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Сохранение...' : 'Завершить'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default RaterForm;
