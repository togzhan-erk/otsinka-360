import React from 'react';
import { CheckCircle2, ArrowLeft } from 'lucide-react';

function TalentThankYouScreen({ onBackToList }) {
  return (
    <div className="container">
      <div className="card thank-you-card">
        <div className="thank-you-icon"><CheckCircle2 size={40} strokeWidth={1.75} /></div>
        <h2>Спасибо, ваша оценка сохранена</h2>
        <p className="thank-you-message">Ответ записан. Если у вас есть другие задачи оценки — вернитесь к списку.</p>
        <button onClick={onBackToList} className="btn btn-primary">
          <ArrowLeft size={16} strokeWidth={2} />
          К списку задач
        </button>
      </div>
    </div>
  );
}

export default TalentThankYouScreen;
