import React, { useState, useEffect } from 'react';
import { getTalentMap, saveTalentMapData } from '../talentMap';
import { DEFAULT_GRADE_TARGETS } from '../talentGrades';
import TalentMapUploadStep from './TalentMapUploadStep';
import TalentMapDistributionStep from './TalentMapDistributionStep';

const STEPS = [
  { key: 'upload', number: 1, title: 'Загрузка' },
  { key: 'distribution', number: 2, title: 'Распределение' },
];

// Карта талантов — отдельный инструмент, доступный только суперадмину
// (проверка isSuperadmin делается в AdminDashboard.jsx перед рендером этого
// компонента). Своя коллекция Firestore (src/talentMap.js: talentMaps/{uid}),
// не пересекается с cycles/* опросов 360 — этот компонент никогда не
// импортирует src/cycles.js и не трогает данные 360.
function TalentMapTab({ currentUser }) {
  const ownerUid = currentUser?.uid;
  const [step, setStep] = useState('upload');
  const [employees, setEmployees] = useState([]);
  const [gradeTargets, setGradeTargets] = useState(DEFAULT_GRADE_TARGETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ownerUid) return;
    setLoading(true);
    getTalentMap(ownerUid)
      .then(data => {
        setEmployees(data?.employees || []);
        setGradeTargets(data?.gradeTargets?.length ? data.gradeTargets : DEFAULT_GRADE_TARGETS);
        setLoading(false);
        setError(null);
      })
      .catch(err => {
        console.error('[TalentMapTab] Failed to load talent map:', err);
        setError(err.message);
        setLoading(false);
      });
  }, [ownerUid]);

  const persistEmployees = async (next) => {
    setEmployees(next);
    try {
      await saveTalentMapData(ownerUid, { employees: next });
    } catch (err) {
      console.error('[TalentMapTab] Failed to save employees:', err);
      alert('Ошибка сохранения сотрудников: ' + err.message);
    }
  };

  const persistGradeTargets = async (next) => {
    setGradeTargets(next);
    try {
      await saveTalentMapData(ownerUid, { gradeTargets: next });
    } catch (err) {
      console.error('[TalentMapTab] Failed to save grade targets:', err);
      alert('Ошибка сохранения таблицы грейдов: ' + err.message);
    }
  };

  const persistAssignments = async (assignments) => {
    await saveTalentMapData(ownerUid, { assignments });
  };

  return (
    <div>
      <h3 style={{ margin: 0 }}>Карта талантов</h3>
      <p style={{ margin: '0.35rem 0 1.5rem', color: 'var(--color-text-muted)' }}>
        Отдельный инструмент оценки по грейдам и модели компетенций — не связан с опросами 360.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {STEPS.map(s => (
          <button
            key={s.key}
            onClick={() => setStep(s.key)}
            className="btn btn-sm"
            style={{
              background: step === s.key ? 'var(--color-primary)' : 'transparent',
              color: step === s.key ? '#fff' : 'var(--color-text-muted)',
              border: `1.5px solid ${step === s.key ? 'var(--color-primary)' : 'var(--color-border)'}`,
            }}
          >
            {s.number}. {s.title}
          </button>
        ))}
      </div>

      {loading && <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>}
      {error && <div className="error-message">Ошибка загрузки карты талантов: {error}</div>}

      {!loading && !error && step === 'upload' && (
        <TalentMapUploadStep
          employees={employees}
          gradeTargets={gradeTargets}
          onSaveEmployees={persistEmployees}
          onSaveGradeTargets={persistGradeTargets}
        />
      )}

      {!loading && !error && step === 'distribution' && (
        <TalentMapDistributionStep
          employees={employees}
          onSaveAssignments={persistAssignments}
        />
      )}
    </div>
  );
}

export default TalentMapTab;
