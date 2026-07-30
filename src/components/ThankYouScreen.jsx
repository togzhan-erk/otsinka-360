import React from 'react';
import { CheckCircle2, Home } from 'lucide-react';

function ThankYouScreen({ onStartOver }) {
  return (
    <div className="container">
      <div className="card thank-you-card">
        <div className="thank-you-icon"><CheckCircle2 size={40} strokeWidth={1.75} /></div>
        <h2>Спасибо за оценку!</h2>
        <p className="thank-you-message">Ваши ответы были успешно записаны.</p>
        <button onClick={onStartOver} className="btn btn-primary">
          <Home size={16} strokeWidth={2} />
          На главную
        </button>
      </div>
    </div>
  );
}

export default ThankYouScreen;
