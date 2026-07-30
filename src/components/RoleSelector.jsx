import React from 'react';
import { Briefcase, Check } from 'lucide-react';

// Raters only ever arrive via their personal invite link (?cycle=...&assignment=...),
// which is resolved before this screen ever renders — there is no manual
// "pick anyone and evaluate them" entry point anymore. This screen is now
// just the admin entry point.
function RoleSelector({ onSelectAdmin }) {
  return (
    <div className="container">
      <div className="card">
        <h2>Панель администратора</h2>
        <p className="subtitle">Войдите, чтобы управлять оценкой 360°</p>

        <div className="role-selector-grid">
          <button
            className="role-card"
            onClick={onSelectAdmin}
          >
            <div className="role-icon"><Briefcase size={26} strokeWidth={1.75} /></div>
            <h3>Я администратор (HRD)</h3>
            <p>Вы управляете процессом оценки</p>
            <ul className="role-features">
              <li><Check size={16} strokeWidth={2} /> Загружаете список сотрудников</li>
              <li><Check size={16} strokeWidth={2} /> Назначаете рейтеров</li>
              <li><Check size={16} strokeWidth={2} /> Видите все результаты</li>
              <li><Check size={16} strokeWidth={2} /> Генерируете ИПР</li>
            </ul>
          </button>
        </div>
      </div>
    </div>
  );
}

export default RoleSelector;
