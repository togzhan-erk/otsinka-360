import React from 'react';

function RoleSelector({ onSelectRater, onSelectAdmin }) {
  return (
    <div className="container">
      <div className="card">
        <h2>Выберите вашу роль</h2>
        <p className="subtitle">В зависимости от роли вам будут доступны разные функции</p>

        <div className="role-selector-grid">
          <button 
            className="role-card"
            onClick={onSelectRater}
          >
            <div className="role-icon">👤</div>
            <h3>Я оценивающий</h3>
            <p>Вы даете оценку компетенциям коллеги</p>
            <ul className="role-features">
              <li>✓ Выставляете баллы по компетенциям</li>
              <li>✓ Даете обратную связь</li>
              <li>✓ Отправляете ответы</li>
            </ul>
          </button>

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