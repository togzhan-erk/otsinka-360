import React, { useState } from 'react';

function AdminDashboard({ employees, roleAssignments, submittedFeedback, onStartOver }) {
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="container">
      <div className="card">
        <h2>Панель администратора</h2>

        <div className="admin-tabs">
          <button 
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            📊 Обзор
          </button>
          <button 
            className={`tab-btn ${activeTab === 'results' ? 'active' : ''}`}
            onClick={() => setActiveTab('results')}
          >
            📈 Результаты
          </button>
        </div>

        {activeTab === 'overview' && (
          <div style={{ marginTop: '2rem' }}>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-number">{employees.length}</div>
                <div className="stat-label">Участников</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{roleAssignments.length}</div>
                <div className="stat-label">Оценок назначено</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{submittedFeedback.length}</div>
                <div className="stat-label">Получено ответов</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'results' && (
          <div style={{ marginTop: '2rem' }}>
            <h3>Результаты</h3>
            <p>Результаты появятся после получения оценок</p>
          </div>
        )}

        <button onClick={onStartOver} className="btn btn-secondary" style={{ marginTop: '2rem' }}>
          ← На главную
        </button>
      </div>
    </div>
  );
}

export default AdminDashboard;