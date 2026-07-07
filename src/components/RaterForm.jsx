import React, { useState } from 'react';

function RaterForm({ evaluee, competencies, onSubmit, currentIndex, totalEvaluees }) {
  const [scores, setScores] = useState(
    competencies.reduce((acc, comp) => ({ ...acc, [comp.id]: 3 }), {})
  );
  const [strength, setStrength] = useState('');
  const [improvement, setImprovement] = useState('');
  const [error, setError] = useState('');

  const handleScoreChange = (compId, value) => {
    setScores({ ...scores, [compId]: parseInt(value) || 3 });
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!strength.trim() || !improvement.trim()) {
      setError('Пожалуйста, ответьте на оба вопроса');
      return;
    }

    onSubmit({
      competencyScores: scores,
      openQuestions: { strength, improvement }
    });
  };

  return (
    <div className="container">
      <div className="card">
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

          <button type="submit" className="btn btn-success">
            Завершить
          </button>
        </form>
      </div>
    </div>
  );
}

export default RaterForm;