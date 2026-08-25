import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { saveTalentMapData, savePairComment, saveFinalAssessment } from '../talentMap';
import { DEFAULT_GRADE_TARGETS } from '../talentGrades';
import { DEFAULT_BAND_THRESHOLDS, isValidBandThresholds } from '../talentCompliance';
import { ensureEmployeeTokens } from '../talentTokens';
import { computeMergedTalentAssignments } from '../talentAssignments';
import TalentMapUploadStep from './TalentMapUploadStep';
import TalentMapDistributionStep from './TalentMapDistributionStep';
import TalentMapProgressStep from './TalentMapProgressStep';
import TalentMapPairReportsStep from './TalentMapPairReportsStep';
import TalentMapFinalScoresStep from './TalentMapFinalScoresStep';

const STEPS = [
  { key: 'upload', number: 1, title: 'Загрузка' },
  { key: 'distribution', number: 2, title: 'Распределение' },
  { key: 'progress', number: 3, title: 'Прохождение' },
  { key: 'pairReports', number: 4, title: 'Отчёты по парам' },
  { key: 'finalScores', number: 5, title: 'Согласованные баллы' },
];

// Карта талантов — отдельный инструмент, доступный только суперадмину
// (проверка isSuperadmin делается в AdminDashboard.jsx перед рендером этого
// компонента). Своя коллекция Firestore (src/talentMap.js: talentMaps/{uid}),
// не пересекается с cycles/* опросов 360 — этот компонент никогда не
// импортирует src/cycles.js и не трогает данные 360.
//
// Живая подписка (onSnapshot), а не разовое чтение: статус задач оценки
// (assignments[].status) меняется на сервере по мере того, как оценивающие
// заполняют форму по своим личным ссылкам (api/talent-task-save.mjs), и
// экран «Распределение» должен отражать это без ручного обновления страницы.
function TalentMapTab({ currentUser }) {
  const ownerUid = currentUser?.uid;
  const [step, setStep] = useState('upload');
  const [employees, setEmployees] = useState([]);
  const [gradeTargets, setGradeTargets] = useState(DEFAULT_GRADE_TARGETS);
  const [assignments, setAssignments] = useState([]);
  const [pairComments, setPairComments] = useState({});
  const [finalAssessments, setFinalAssessments] = useState({});
  const [bandThresholds, setBandThresholds] = useState(DEFAULT_BAND_THRESHOLDS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!ownerUid) return;
    setLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, 'talentMaps', ownerUid),
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setEmployees(data?.employees || []);
        setGradeTargets(data?.gradeTargets?.length ? data.gradeTargets : DEFAULT_GRADE_TARGETS);
        setAssignments(data?.assignments || []);
        setPairComments(data?.pairComments || {});
        setFinalAssessments(data?.finalAssessments || {});
        setBandThresholds(isValidBandThresholds(data?.bandThresholds) ? data.bandThresholds : DEFAULT_BAND_THRESHOLDS);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('[TalentMapTab] Failed to load talent map:', err);
        setError(err.message);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [ownerUid]);

  // Каждое сохранение списка сотрудников:
  //  1) гарантирует, что у всех есть персональный токен (src/talentTokens.js)
  //     — уже существующие токены не трогаются, иначе выданные ранее ссылки
  //     перестали бы работать;
  //  2) пересчитывает и сохраняет assignments В ТОМ ЖЕ Firestore-вызове.
  // Раньше assignments сохранялись только когда админ отдельно заходил на
  // шаг «Распределение» и жал «Сохранить распределение» — до этого клика
  // поле assignments в talentMaps/{uid} оставалось пустым, и личная ссылка
  // сотрудника показывала «Задач пока нет» даже при реально существующих
  // задачах (api/talent-tasks.mjs читает assignments из этого же документа).
  // Теперь сотрудники и назначения всегда сохраняются согласованно — одним
  // и тем же вызовом saveTalentMapData, сразу после загрузки Excel.
  // computeMergedTalentAssignments (не «с нуля») сохраняет status уже
  // начатых/завершённых задач при пересчёте.
  const persistEmployees = async (rawNext) => {
    const { employees: next } = ensureEmployeeTokens(rawNext);
    const mergedAssignments = computeMergedTalentAssignments(next, assignments);
    try {
      await saveTalentMapData(ownerUid, { employees: next, assignments: mergedAssignments });
    } catch (err) {
      console.error('[TalentMapTab] Failed to save employees:', err);
      alert('Ошибка сохранения сотрудников: ' + err.message);
    }
  };

  const persistGradeTargets = async (next) => {
    try {
      await saveTalentMapData(ownerUid, { gradeTargets: next });
    } catch (err) {
      console.error('[TalentMapTab] Failed to save grade targets:', err);
      alert('Ошибка сохранения таблицы грейдов: ' + err.message);
    }
  };

  const persistAssignments = async (nextAssignments) => {
    await saveTalentMapData(ownerUid, { assignments: nextAssignments });
  };

  const persistPairComment = async (evalueeId, comment) => {
    await savePairComment(ownerUid, evalueeId, comment);
  };

  const persistFinalAssessment = async (evalueeId, assessment) => {
    await saveFinalAssessment(ownerUid, evalueeId, assessment);
  };

  const persistBandThresholds = async (next) => {
    try {
      await saveTalentMapData(ownerUid, { bandThresholds: next });
    } catch (err) {
      console.error('[TalentMapTab] Failed to save band thresholds:', err);
      alert('Ошибка сохранения порогов: ' + err.message);
    }
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
          bandThresholds={bandThresholds}
          onSaveBandThresholds={persistBandThresholds}
        />
      )}

      {!loading && !error && step === 'distribution' && (
        <TalentMapDistributionStep
          employees={employees}
          assignments={assignments}
          onSaveAssignments={persistAssignments}
        />
      )}

      {!loading && !error && step === 'progress' && (
        <TalentMapProgressStep
          employees={employees}
          assignments={assignments}
        />
      )}

      {!loading && !error && step === 'pairReports' && (
        <TalentMapPairReportsStep
          employees={employees}
          assignments={assignments}
          ownerUid={ownerUid}
          pairComments={pairComments}
          onSaveComment={persistPairComment}
        />
      )}

      {!loading && !error && step === 'finalScores' && (
        <TalentMapFinalScoresStep
          employees={employees}
          assignments={assignments}
          gradeTargets={gradeTargets}
          bandThresholds={bandThresholds}
          ownerUid={ownerUid}
          finalAssessments={finalAssessments}
          onSaveFinalAssessment={persistFinalAssessment}
        />
      )}
    </div>
  );
}

export default TalentMapTab;
