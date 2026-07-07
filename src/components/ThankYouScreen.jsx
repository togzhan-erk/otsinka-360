import React from 'react';

function ThankYouScreen({ onStartOver }) {
  return (
    <div className="container">
      <div className="card thank-you-card">
        <div className="thank-you-icon">✓</div>
        <h2>Спасибо за оценку!</h2>
        <p className="thank-you-message">Ваши ответы были успешно записаны.</p>
        <button onClick={onStartOver} className="btn btn-primary">
          ← На главную
        </button>
      </div>
    </div>
  );
}

export default ThankYouScreen;