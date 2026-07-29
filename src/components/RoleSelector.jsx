import React from 'react';

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
            <div className="role-icon">👔</div>
            <h3>Я администратор (HRD)</h3>
            <p>Вы управляете процессом оценки</p>
            <ul className="role-features">
              <li>✓ Загружаете список сотрудников</li>
              <li>✓ Назначаете рейтеров</li>
              <li>✓ Видите все результаты</li>
              <li>✓ Генерируете ИПР</li>
            </ul>
          </button>
        </div>
      </div>
    </div>
  );
}

export default RoleSelector;
