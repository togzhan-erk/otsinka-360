import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

function AdminDashboard({ employees, roleAssignments, submittedFeedback, onStartOver, competencies }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [feedbackList, setFeedbackList] = useState([]);
  const [loadingResults, setLoadingResults] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'feedback'), orderBy('submittedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setFeedbackList(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoadingResults(false);
    }, () => {
      setLoadingResults(false);
    });
    return unsubscribe;
  }, []);

  const grouped = feedbackList.reduce((acc, item) => {
    const key = item.evalueeName || 'Неизвестный';
    if (!acc[key]) acc[key] = { name: key, feedbacks: [] };
    acc[key].feedbacks.push(item);
    return acc;
  }, {});

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
                <div className="stat-number">{feedbackList.length}</div>
                <div className="stat-label">Получено ответов</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'results' && (
          <div style={{ marginTop: '2rem' }}>
            <h3>Результаты оценок</h3>

            {loadingResults && <p>Загрузка...</p>}

            {!loadingResults && feedbackList.length === 0 && (
              <p style={{ color: '#6f6f77' }}>Оценок пока нет. Они появятся здесь после того, как участники заполнят форму.</p>
            )}

            {!loadingResults && Object.values(grouped).map(group => (
              <EmployeeResult
                key={group.name}
                group={group}
                competencies={competencies || []}
              />
            ))}
          </div>
        )}

        <button onClick={onStartOver} className="btn btn-secondary" style={{ marginTop: '2rem' }}>
          ← На главную
        </button>
      </div>
    </div>
  );
}

function EmployeeResult({ group, competencies }) {
  const avgScores = competencies.map(comp => {
    const vals = group.feedbacks
      .map(f => f.competencyScores?.[comp.id] ?? f.competencyScores?.[String(comp.id)])
      .filter(v => v !== undefined && v !== null);
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { ...comp, avg };
  });

  const strengths = group.feedbacks.map(f => f.openQuestions?.strength).filter(Boolean);
  const improvements = group.feedbacks.map(f => f.openQuestions?.improvement).filter(Boolean);

  return (
    <div style={{ border: '1px solid #e5e5e7', borderRadius: '8px', padding: '1.5rem', marginBottom: '1.5rem' }}>
      <h4 style={{ marginBottom: '0.25rem' }}>{group.name}</h4>
      <p style={{ color: '#6f6f77', fontSize: '0.9rem', marginBottom: '1rem' }}>
        {group.feedbacks.length} оценок · типы: {[...new Set(group.feedbacks.map(f => f.raterType))].join(', ')}
      </p>

      {avgScores.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <strong>Средние баллы:</strong>
          {avgScores.map(comp => (
            <div key={comp.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0', borderBottom: '1px solid #f5f5f7' }}>
              <span>{comp.name}</span>
              <span style={{ fontWeight: '600', color: comp.avg >= 4 ? '#34c759' : comp.avg >= 3 ? '#ff9500' : '#ff3b30' }}>
                {comp.avg !== null ? comp.avg.toFixed(1) : '—'} / 5
              </span>
            </div>
          ))}
        </div>
      )}

      {strengths.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <strong>Сильные стороны:</strong>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
            {strengths.map((s, i) => <li key={i} style={{ marginBottom: '0.25rem', color: '#3c3c44' }}>{s}</li>)}
          </ul>
        </div>
      )}

      {improvements.length > 0 && (
        <div>
          <strong>Зоны развития:</strong>
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
            {improvements.map((s, i) => <li key={i} style={{ marginBottom: '0.25rem', color: '#3c3c44' }}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
