import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

function AdminDashboard({ employees, roleAssignments, submittedFeedback, onStartOver, onNewProject, competencies }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [feedbackList, setFeedbackList] = useState([]);
  const [loadingResults, setLoadingResults] = useState(true);
  const [firestoreError, setFirestoreError] = useState(null);

  useEffect(() => {
    console.log('[AdminDashboard] Subscribing to feedback collection...');
    const unsubscribe = onSnapshot(
      collection(db, 'feedback'),
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log('[AdminDashboard] Received', data.length, 'feedback docs:', data);
        setFeedbackList(data);
        setLoadingResults(false);
        setFirestoreError(null);
      },
      (err) => {
        console.error('[AdminDashboard] Firestore read error:', err.code, err.message);
        setFirestoreError(err.message);
        setLoadingResults(false);
      }
    );
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

            {employees.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4>Сотрудники в проекте:</h4>
                <ul style={{ paddingLeft: '1.5rem', color: '#3c3c44' }}>
                  {employees.map(emp => (
                    <li key={emp.id}>{emp.name} — {emp.email}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === 'results' && (
          <div style={{ marginTop: '2rem' }}>
            <h3>Результаты оценок</h3>

            {loadingResults && <p style={{ color: '#6f6f77' }}>Загрузка из Firestore...</p>}

            {firestoreError && (
              <div className="error-message">
                Ошибка чтения из Firestore: {firestoreError}
                <br />
                <small>Проверьте правила безопасности в Firebase Console → Firestore → Rules</small>
              </div>
            )}

            {!loadingResults && !firestoreError && feedbackList.length === 0 && (
              <p style={{ color: '#6f6f77' }}>
                Оценок пока нет. Они появятся здесь после того, как участники заполнят форму.
                <br />
                <small>Если вы только что отправили оценку — откройте DevTools (F12) → Console и проверьте логи.</small>
              </p>
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

        <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button
            onClick={onNewProject}
            className="btn btn-success"
            style={{ background: '#ff3b30' }}
          >
            + Начать новый проект оценки
          </button>
          <button onClick={onStartOver} className="btn btn-secondary">
            ← На главную
          </button>
        </div>
      </div>
    </div>
  );
}

function EmployeeResult({ group, competencies }) {
  const avgScores = competencies.map(comp => {
    const vals = group.feedbacks
      .map(f => {
        const byNum = f.competencyScores?.[comp.id];
        const byStr = f.competencyScores?.[String(comp.id)];
        return byNum ?? byStr;
      })
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
        {group.feedbacks.length} {group.feedbacks.length === 1 ? 'оценка' : 'оценок'} · типы: {[...new Set(group.feedbacks.map(f => f.raterType))].join(', ')}
      </p>

      {avgScores.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <strong>Средние баллы:</strong>
          {avgScores.map(comp => (
            <div key={comp.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid #f5f5f7' }}>
              <span>{comp.name}</span>
              <span style={{ fontWeight: '600', color: comp.avg === null ? '#c7c7cc' : comp.avg >= 4 ? '#34c759' : comp.avg >= 3 ? '#ff9500' : '#ff3b30' }}>
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
