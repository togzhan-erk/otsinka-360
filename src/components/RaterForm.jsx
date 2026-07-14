import React, { useState } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

function BackButton({ onBack }) {
  if (!onBack) return null;
  return (
    <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '0.9rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500, padding: 0, marginBottom: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
      ← Назад
    </button>
  );
}

function RaterForm({ evaluee, competencies, onSubmit, onBack, currentIndex, totalEvaluees, raterType }) {
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

    const payload = {
      evalueeId: evaluee.id,
      evalueeName: evaluee.name,
      raterType: raterType || 'unknown',
      competencyScores: scores,
      openQuestions: { strength, improvement },
      submittedAt: serverTimestamp(),
    };
    console.log('[RaterForm] Writing to Firestore feedback collection:', payload);

    try {
      const docRef = await addDoc(collection(db, 'feedback'), payload);
      console.log('[RaterForm] Successfully written, doc ID:', docRef.id);
      onSubmit({ competencyScores: scores, openQuestions: { strength, improvement } });
    } catch (err) {
      console.error('[RaterForm] Firestore write error:', err.code, err.message);
      setError('Ошибка сохранения: ' + err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="card">
        <BackButton onBack={onBack} />
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
              <label><strong>Что делает хорошо?</strong> *</label>
              <textarea
                value={strength}
                onChange={(e) => setStrength(e.target.value)}
                placeholder="Опишите..."
                className="textarea"
                rows="4"
              />
            </div>

            <div className="form-group">
              <label><strong>Что развивать?</strong> *</label>
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

          <button type="submit" className="btn btn-success" disabled={submitting}>
            {submitting ? 'Сохранение...' : 'Завершить'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default RaterForm;
