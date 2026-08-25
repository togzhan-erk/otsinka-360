import React, { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { isSuperadmin } from '../auth';
import {
  TALENT_MAP_DOC_ID, saveTalentMapData, savePairComment, saveFinalAssessment, saveYAxisAssessment,
  saveTalentPoolOverride, saveIdpPlan, migrateTalentMapToSharedDocIfNeeded,
} from '../talentMap';
import { DEFAULT_GRADE_TARGETS } from '../talentGrades';
import { DEFAULT_BAND_THRESHOLDS, isValidBandThresholds } from '../talentCompliance';
import { ensureEmployeeTokens } from '../talentTokens';
import { computeMergedTalentAssignments } from '../talentAssignments';
import TalentMapUploadStep from './TalentMapUploadStep';
import TalentMapDistributionStep from './TalentMapDistributionStep';
import TalentMapProgressStep from './TalentMapProgressStep';
import TalentMapPairReportsStep from './TalentMapPairReportsStep';
import TalentMapFinalScoresStep from './TalentMapFinalScoresStep';
import TalentMapNineBoxStep from './TalentMapNineBoxStep';
import TalentMapIdpStep from './TalentMapIdpStep';
import TalentMapAccessPanel from './TalentMapAccessPanel';

const BASE_STEPS = [
  { key: 'upload', number: 1, title: 'Загрузка' },
  { key: 'distribution', number: 2, title: 'Распределение' },
  { key: 'progress', number: 3, title: 'Прохождение' },
  { key: 'pairReports', number: 4, title: 'Отчёты по парам' },
  { key: 'finalScores', number: 5, title: 'Согласованные баллы' },
  { key: 'nineBox', number: 6, title: 'Карта талантов' },
  { key: 'idp', number: 7, title: 'План развития' },
];

// Карта талантов — отдельный инструмент. Доступ = суперадмин ИЛИ email из
// allowedEmails на самом документе карты (проверяется в AdminDashboard.jsx
// перед рендером этого компонента — там же решается, показывать ли пункт
// навигации). Своя коллекция Firestore (src/talentMap.js:
// talentMaps/main — ОДИН фиксированный документ на всю компанию, не
// привязанный к чьему-либо uid), не пересекается с cycles/* опросов 360 —
// этот компонент никогда не импортирует src/cycles.js и не трогает
// данные 360.
//
// Живая подписка (onSnapshot) на фиксированный путь — не нужно ничего
// резолвить асинхронно (раньше документ жил на talentMaps/{ownerUid} и
// требовал отдельного запроса, чтобы узнать чей uid; теперь путь
// известен заранее). Статус задач оценки (assignments[].status) меняется
// на сервере по мере того, как оценивающие заполняют форму по своим
// личным ссылкам (api/talent.mjs, action=save-task), и экран
// «Распределение» должен отражать это без ручного обновления страницы.
function TalentMapTab({ currentUser }) {
  const isSuperadminUser = isSuperadmin(currentUser);
  const [step, setStep] = useState('upload');
  const [employees, setEmployees] = useState([]);
  const [gradeTargets, setGradeTargets] = useState(DEFAULT_GRADE_TARGETS);
  const [assignments, setAssignments] = useState([]);
  const [pairComments, setPairComments] = useState({});
  const [finalAssessments, setFinalAssessments] = useState({});
  const [bandThresholds, setBandThresholds] = useState(DEFAULT_BAND_THRESHOLDS);
  const [yAxisAssessments, setYAxisAssessments] = useState({});
  const [quadrants, setQuadrants] = useState({});
  const [talentPoolOverrides, setTalentPoolOverrides] = useState({});
  const [idpPlans, setIdpPlans] = useState({});
  const [allowedEmails, setAllowedEmails] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Одноразовая миграция talentMaps/{uid суперадмина} → talentMaps/main —
  // осмысленна только когда её запускает сам суперадмин (только под его
  // uid легаси-документ вообще мог существовать); для остальных
  // разрешённых пользователей это без эффекта (см. комментарий в
  // src/talentMap.js).
  useEffect(() => {
    if (!currentUser || !isSuperadminUser) return;
    migrateTalentMapToSharedDocIfNeeded(currentUser.uid).catch((err) => {
      console.error('[TalentMapTab] Migration attempt failed:', err);
    });
  }, [currentUser, isSuperadminUser]);

  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, 'talentMaps', TALENT_MAP_DOC_ID),
      (snap) => {
        const data = snap.exists() ? snap.data() : null;
        setEmployees(data?.employees || []);
        setGradeTargets(data?.gradeTargets?.length ? data.gradeTargets : DEFAULT_GRADE_TARGETS);
        setAssignments(data?.assignments || []);
        setPairComments(data?.pairComments || {});
        setFinalAssessments(data?.finalAssessments || {});
        setBandThresholds(isValidBandThresholds(data?.bandThresholds) ? data.bandThresholds : DEFAULT_BAND_THRESHOLDS);
        setYAxisAssessments(data?.yAxisAssessments || {});
        setQuadrants(data?.quadrants || {});
        setTalentPoolOverrides(data?.talentPoolOverrides || {});
        setIdpPlans(data?.idpPlans || {});
        setAllowedEmails(data?.allowedEmails || []);
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
  }, []);

  // Каждое сохранение списка сотрудников:
  //  1) гарантирует, что у всех есть персональный токен (src/talentTokens.js)
  //     — уже существующие токены не трогаются, иначе выданные ранее ссылки
  //     перестали бы работать;
  //  2) пересчитывает и сохраняет assignments В ТОМ ЖЕ Firestore-вызове.
  // Раньше assignments сохранялись только когда админ отдельно заходил на
  // шаг «Распределение» и жал «Сохранить распределение» — до этого клика
  // поле assignments в talentMaps/main оставалось пустым, и личная ссылка
  // сотрудника показывала «Задач пока нет» даже при реально существующих
  // задачах (api/talent.mjs читает assignments из этого же документа).
  // Теперь сотрудники и назначения всегда сохраняются согласованно — одним
  // и тем же вызовом saveTalentMapData, сразу после загрузки Excel.
  // computeMergedTalentAssignments (не «с нуля») сохраняет status уже
  // начатых/завершённых задач при пересчёте.
  const persistEmployees = async (rawNext) => {
    const { employees: next } = ensureEmployeeTokens(rawNext);
    const mergedAssignments = computeMergedTalentAssignments(next, assignments);
    try {
      await saveTalentMapData({ employees: next, assignments: mergedAssignments });
    } catch (err) {
      console.error('[TalentMapTab] Failed to save employees:', err);
      alert('Ошибка сохранения сотрудников: ' + err.message);
    }
  };

  const persistGradeTargets = async (next) => {
    try {
      await saveTalentMapData({ gradeTargets: next });
    } catch (err) {
      console.error('[TalentMapTab] Failed to save grade targets:', err);
      alert('Ошибка сохранения таблицы грейдов: ' + err.message);
    }
  };

  const persistAssignments = async (nextAssignments) => {
    await saveTalentMapData({ assignments: nextAssignments });
  };

  const persistPairComment = async (evalueeId, comment) => {
    await savePairComment(evalueeId, comment);
  };

  const persistFinalAssessment = async (evalueeId, assessment) => {
    await saveFinalAssessment(evalueeId, assessment);
  };

  const persistBandThresholds = async (next) => {
    try {
      await saveTalentMapData({ bandThresholds: next });
    } catch (err) {
      console.error('[TalentMapTab] Failed to save band thresholds:', err);
      alert('Ошибка сохранения порогов: ' + err.message);
    }
  };

  const persistYAxisAssessment = async (evalueeId, data) => {
    try {
      await saveYAxisAssessment(evalueeId, data);
    } catch (err) {
      console.error('[TalentMapTab] Failed to save Y-axis assessment:', err);
      alert('Ошибка сохранения оси Y: ' + err.message);
    }
  };

  const persistQuadrants = async (next) => {
    try {
      await saveTalentMapData({ quadrants: next });
    } catch (err) {
      console.error('[TalentMapTab] Failed to save quadrants:', err);
      alert('Ошибка сохранения настройки ячеек: ' + err.message);
    }
  };

  const persistPoolOverride = async (poolKey, override) => {
    try {
      await saveTalentPoolOverride(poolKey, override);
    } catch (err) {
      console.error('[TalentMapTab] Failed to save talent pool override:', err);
      alert('Ошибка сохранения пула: ' + err.message);
    }
  };

  const persistIdpPlan = async (evalueeId, plan) => {
    await saveIdpPlan(evalueeId, plan);
  };

  // Только суперадмин может менять allowedEmails — firestore.rules это
  // обеспечивают на уровне записи, а видимость самой панели (и пункта
  // «Доступ» в навигации ниже) гейтится isSuperadminUser здесь же.
  const persistAllowedEmails = async (next) => {
    await saveTalentMapData({ allowedEmails: next });
  };

  const steps = isSuperadminUser
    ? [...BASE_STEPS, { key: 'access', number: 8, title: 'Доступ' }]
    : BASE_STEPS;

  return (
    <div>
      <h3 style={{ margin: 0 }}>Карта талантов</h3>
      <p style={{ margin: '0.35rem 0 1.5rem', color: 'var(--color-text-muted)' }}>
        Отдельный инструмент оценки по грейдам и модели компетенций — не связан с опросами 360.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {steps.map(s => (
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
          currentUser={currentUser}
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
          finalAssessments={finalAssessments}
          onSaveFinalAssessment={persistFinalAssessment}
        />
      )}

      {!loading && !error && step === 'nineBox' && (
        <TalentMapNineBoxStep
          employees={employees}
          assignments={assignments}
          bandThresholds={bandThresholds}
          finalAssessments={finalAssessments}
          yAxisAssessments={yAxisAssessments}
          quadrants={quadrants}
          talentPoolOverrides={talentPoolOverrides}
          onSaveYAxis={persistYAxisAssessment}
          onSaveQuadrants={persistQuadrants}
          onSavePoolOverride={persistPoolOverride}
        />
      )}

      {!loading && !error && step === 'idp' && (
        <TalentMapIdpStep
          employees={employees}
          assignments={assignments}
          currentUser={currentUser}
          finalAssessments={finalAssessments}
          idpPlans={idpPlans}
          onSavePlan={persistIdpPlan}
        />
      )}

      {!loading && !error && step === 'access' && isSuperadminUser && (
        <TalentMapAccessPanel
          allowedEmails={allowedEmails}
          onSave={persistAllowedEmails}
        />
      )}
    </div>
  );
}

export default TalentMapTab;
