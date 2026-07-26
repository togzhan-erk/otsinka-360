import React, { useState, useCallback, useEffect } from 'react';
import './App.css';
import RoleSelector from './components/RoleSelector';
import RaterForm from './components/RaterForm';
import ThankYouScreen from './components/ThankYouScreen';
import AdminUpload from './components/AdminUpload';
import RoleAssignment from './components/RoleAssignment';
import AdminDashboard from './components/AdminDashboard';
import EmployeeReport from './components/EmployeeReport';
import { db } from './firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import {
  migrateLegacyDataIfNeeded, getActiveCycle, getCycle,
  saveCycleData, archiveCycle, createCycle,
} from './cycles';

const EMPLOYEE_COMPETENCIES = [
  { id: 1, name: 'Коммуникация', question: 'Ясно выражает свои идеи и активно слушает других' },
  { id: 2, name: 'Командная работа', question: 'Поддерживает атмосферу в команде и помогает коллегам' },
  { id: 3, name: 'Управление временем', question: 'Планирует работу и соблюдает сроки' },
  { id: 4, name: 'Качество работы', question: 'Обращает внимание на детали и стремится к совершенству' },
  { id: 5, name: 'Инициатива и решение проблем', question: 'Проактивно предлагает идеи и решает проблемы' },
  { id: 6, name: 'Ответственность', question: 'Надежен и отвечает за результаты своей работы' }
];

const RELATIONSHIP_TYPES = [
  { value: 'self', label: 'Самооценка', description: 'Оцениваю себя сам', icon: '🪞' },
  { value: 'manager', label: 'Руководитель', description: 'Я его прямой руководитель', icon: '👔' },
  { value: 'colleague', label: 'Коллега', description: 'Мы работаем на одном уровне', icon: '👥' },
  { value: 'subordinate', label: 'Подчиненный', description: 'Он мой прямой подчиненный', icon: '👤' }
];

// Capture invite params at module load time — before any React effects run or
// history.replaceState clears the URL. This is the only safe place to read them.
const _initialParams = new URLSearchParams(window.location.search);
const INVITE = {
  evalueeId: _initialParams.get('evaluee'),
  raterId: _initialParams.get('rater'),
  type: _initialParams.get('type'),
  cycleId: _initialParams.get('cycle'),
  assignmentId: _initialParams.get('assignment'),
};
console.log('[App] URL params captured at module load:', window.location.search, INVITE);

function resolveInviteFromProject(projectData) {
  if (!INVITE.evalueeId || !INVITE.raterId || !INVITE.type) return null;
  const employees = projectData?.employees || [];
  const evaluee = employees.find(e => e.id === INVITE.evalueeId);
  const rater = employees.find(e => e.id === INVITE.raterId);
  if (!evaluee || !rater) {
    console.warn('[App] Invite params found but could not match employees. evalueeId:', INVITE.evalueeId, 'raterId:', INVITE.raterId, 'employees in project:', employees.map(e => e.id));
    return null;
  }
  const relationType = RELATIONSHIP_TYPES.find(r => r.value === INVITE.type);
  return { evaluee, rater, raterTypeValue: INVITE.type, raterTypeLabel: relationType?.label || INVITE.type };
}

function App() {
  const [userRole, setUserRole] = useState(null);
  const [stage, setStage] = useState('roleSelector');
  const [currentEvaluee, setCurrentEvaluee] = useState(null);
  const [currentRaterType, setCurrentRaterType] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [roleAssignments, setRoleAssignments] = useState([]);
  const [submittedFeedback, setSubmittedFeedback] = useState([]);
  const [navigationStack, setNavigationStack] = useState([]);
  const [reportData, setReportData] = useState(null); // { name, feedbacks, cycleId, readOnly }
  const [currentCycleId, setCurrentCycleId] = useState(null);
  const [currentAssignmentId, setCurrentAssignmentId] = useState(null);

  // On first load: run the one-time legacy-data migration, then if invite
  // params were captured at module level, resolve the right cycle and open RaterForm.
  useEffect(() => {
    (async () => {
      try {
        await migrateLegacyDataIfNeeded();
      } catch (err) {
        console.error('[App] Migration check failed:', err);
      }

      if (!INVITE.evalueeId) return; // not an invite link

      setStage('loadingRaterData');
      try {
        // Invite links carry their own cycle id so answers land in the right
        // survey. Older links sent before cycles existed have no ?cycle=
        // param — fall back to whichever cycle is active today.
        const cycle = (INVITE.cycleId ? await getCycle(INVITE.cycleId) : null) || await getActiveCycle();
        const invite = cycle ? resolveInviteFromProject(cycle) : null;

        if (invite && cycle) {
          console.log('[App] Invite resolved successfully:', invite, 'cycle:', cycle.id);
          setEmployees(cycle.employees || []);
          setCurrentCycleId(cycle.id);
          setCurrentAssignmentId(INVITE.assignmentId || null);
          setCurrentEvaluee(invite.evaluee.name);
          setCurrentRaterType(invite.raterTypeValue);
          setUserRole('rater');
          setStage('raterForm');
          window.history.replaceState({}, '', '/');
        } else {
          console.warn('[App] Invite params present but could not resolve — showing role selector');
          setStage('roleSelector');
        }
      } catch (err) {
        console.error('[App] Error resolving invite link:', err);
        setStage('roleSelector');
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const captureNav = () => ({ stage, userRole, currentEvaluee, currentRaterType });

  const pushNav = () => {
    setNavigationStack(prev => [...prev, captureNav()]);
    window.history.pushState({}, '', '/');
  };

  const goBack = useCallback(() => {
    setNavigationStack(prev => {
      if (prev.length === 0) return prev;
      const snap = prev[prev.length - 1];
      setStage(snap.stage);
      setUserRole(snap.userRole);
      setCurrentEvaluee(snap.currentEvaluee);
      setCurrentRaterType(snap.currentRaterType);
      return prev.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    // Don't overwrite URL if we're processing an invite link — the invite effect handles cleanup.
    if (!INVITE.evalueeId) {
      window.history.replaceState({}, '', '/');
    }
    window.addEventListener('popstate', goBack);
    return () => window.removeEventListener('popstate', goBack);
  }, [goBack]);

  // ── Rater flow ─────────────────────────────────────────────────────────────
  const handleSelectRaterRole = async () => {
    pushNav();
    setUserRole('rater');
    setStage('loadingRaterData');
    try {
      const cycle = await getActiveCycle();
      console.log('[App] Rater flow: loaded active cycle:', cycle);
      setEmployees(cycle?.employees || []);
      setCurrentCycleId(cycle?.id || null);
      setCurrentAssignmentId(null); // manual entry has no assignment context to link back to
    } catch (err) {
      console.error('[App] Rater flow: error loading employees:', err);
      setEmployees([]);
    }
    setStage('selectEvaluee');
  };

  const handleSelectEvaluee = (name) => {
    pushNav();
    setCurrentEvaluee(name);
    setStage('selectRaterType');
  };

  const handleSelectRaterType = (relationType) => {
    pushNav();
    setCurrentRaterType(relationType);
    setStage('raterForm');
  };

  const handleRaterSubmitFeedback = (feedback) => {
    setSubmittedFeedback(prev => [...prev, feedback]);
    setNavigationStack([]);
    setStage('thankYou');
  };

  // ── Admin flow ─────────────────────────────────────────────────────────────
  const handleSelectAdminRole = async () => {
    pushNav();
    setUserRole('admin');
    setStage('checkingProject');
    try {
      await migrateLegacyDataIfNeeded();
      const cycle = await getActiveCycle();
      console.log('[App] Admin flow: active cycle:', cycle);
      setCurrentCycleId(cycle?.id || null);
      if (cycle && (cycle.roleAssignments || []).length > 0) {
        setEmployees(cycle.employees || []);
        setRoleAssignments(cycle.roleAssignments || []);
        setStage('adminDashboard');
      } else {
        console.log('[App] Admin flow: active cycle has no assignments yet, starting setup');
        setEmployees(cycle?.employees || []);
        setStage('adminUpload');
      }
    } catch (err) {
      console.error('[App] Admin flow: error checking active cycle:', err);
      setStage('adminUpload');
    }
  };

  const handleAdminUploadFile = (employeesData) => {
    pushNav();
    setEmployees(employeesData);
    setStage('roleAssignment');
  };

  const handleRoleAssignmentComplete = async (assignments, uploadedEmployees) => {
    const employeesToSave = uploadedEmployees || employees;
    setRoleAssignments(assignments);
    console.log('[App] Admin flow: saving cycle data. Employees:', employeesToSave, 'Assignments:', assignments);
    try {
      await saveCycleData(currentCycleId, { employees: employeesToSave, roleAssignments: assignments });
      console.log('[App] Admin flow: cycle saved to Firestore successfully');
    } catch (err) {
      console.error('[App] Admin flow: failed to save cycle:', err);
    }
    setNavigationStack([]);
    setStage('adminDashboard');
  };

  const handleDeleteAssignment = async (assignmentId) => {
    const filtered = roleAssignments.filter(a => a.id !== assignmentId);
    setRoleAssignments(filtered);
    try {
      await saveCycleData(currentCycleId, { employees, roleAssignments: filtered });
      console.log('[App] Assignment deleted, cycle updated in Firestore');
    } catch (err) {
      console.error('[App] Failed to update cycle after assignment deletion:', err);
    }
  };

  const handleStartNewSurvey = async (name) => {
    console.log('[App] Starting new survey cycle:', name, '— archiving current cycle:', currentCycleId);
    try {
      if (currentCycleId) {
        await archiveCycle(currentCycleId);
      }
      const newId = await createCycle(name);
      setCurrentCycleId(newId);
      setEmployees([]);
      setRoleAssignments([]);
      setNavigationStack([]);
      setStage('adminUpload');
      console.log('[App] New cycle created:', newId);
    } catch (err) {
      console.error('[App] Failed to start new survey:', err);
      alert('Ошибка при создании нового опроса: ' + err.message);
    }
  };

  const handleOpenReport = (name, feedbacks, opts = {}) => {
    pushNav();
    setReportData({ name, feedbacks, cycleId: opts.cycleId || currentCycleId, readOnly: !!opts.readOnly });
    setStage('employeeReport');
  };

  const handleDeleteFeedback = async (feedbackItem) => {
    const confirmed = window.confirm(
      `Удалить эту оценку?\n\nОцениваемый: ${feedbackItem.evalueeName}\nТип: ${feedbackItem.raterType}\n\nЭто действие необратимо.`
    );
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'cycles', reportData.cycleId, 'feedback', feedbackItem.id));
      console.log('[App] Deleted feedback doc', feedbackItem.id, 'from cycle', reportData.cycleId);
      setReportData(prev =>
        prev ? { ...prev, feedbacks: prev.feedbacks.filter(f => f.id !== feedbackItem.id) } : prev
      );
    } catch (err) {
      console.error('[App] Failed to delete feedback:', err);
      alert('Ошибка удаления: ' + err.message);
    }
  };

  const handleStartOver = () => {
    setNavigationStack([]);
    setUserRole(null);
    setStage('roleSelector');
    setCurrentEvaluee(null);
    setCurrentRaterType(null);
    setEmployees([]);
    setRoleAssignments([]);
    setSubmittedFeedback([]);
    setCurrentCycleId(null);
    setCurrentAssignmentId(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Оценка 360 — ИПР генератор</h1>
        <p>Индивидуальный план развития на основе AI анализа</p>
      </header>

      <main className="app-main">
        {stage === 'roleSelector' && (
          <RoleSelector
            onSelectRater={handleSelectRaterRole}
            onSelectAdmin={handleSelectAdminRole}
          />
        )}

        {(stage === 'checkingProject' || stage === 'loadingRaterData') && (
          <div className="container">
            <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '1.1rem' }}>Загрузка...</p>
            </div>
          </div>
        )}

        {userRole === 'rater' && stage === 'selectEvaluee' && (
          <div className="container">
            <div className="card">
              <BackButton onBack={navigationStack.length > 0 ? goBack : null} />
              <h2>Выберите оцениваемого</h2>
              <p className="subtitle">Кого вы будете оценивать?</p>
              {employees.length === 0 && (
                <div className="error-message" style={{ marginBottom: '1rem' }}>
                  Список сотрудников не найден. Убедитесь, что HR-директор уже создал проект оценки.
                </div>
              )}
              <SelectEvalueeForm
                employees={employees.map(e => e.name)}
                onSelect={handleSelectEvaluee}
              />
            </div>
          </div>
        )}

        {userRole === 'rater' && stage === 'selectRaterType' && (
          <div className="container">
            <div className="card">
              <BackButton onBack={navigationStack.length > 0 ? goBack : null} />
              <h2>Выберите тип отношения</h2>
              <p className="subtitle">Какой тип отношения у вас с {currentEvaluee}?</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '2rem' }}>
                {RELATIONSHIP_TYPES.map(type => (
                  <button
                    key={type.value}
                    onClick={() => handleSelectRaterType(type.value)}
                    className="role-card"
                    style={{ minHeight: 'auto', padding: '1.5rem' }}
                  >
                    <div style={{ fontSize: '1.5rem' }}>{type.icon}</div>
                    <div style={{ fontWeight: '600' }}>{type.label}</div>
                    <div style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>{type.description}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {userRole === 'rater' && stage === 'raterForm' && currentEvaluee && (
          <RaterForm
            evaluee={{ id: currentEvaluee, name: currentEvaluee }}
            competencies={EMPLOYEE_COMPETENCIES}
            employeeType="employee"
            onSubmit={handleRaterSubmitFeedback}
            onBack={navigationStack.length > 0 ? goBack : null}
            currentIndex={1}
            totalEvaluees={1}
            raterType={RELATIONSHIP_TYPES.find(t => t.value === currentRaterType)?.label}
            cycleId={currentCycleId}
            assignmentId={currentAssignmentId}
          />
        )}

        {userRole === 'rater' && stage === 'thankYou' && (
          <ThankYouScreen onStartOver={handleStartOver} />
        )}

        {userRole === 'admin' && stage === 'adminUpload' && (
          <AdminUpload
            onUpload={handleAdminUploadFile}
            onBack={navigationStack.length > 0 ? goBack : null}
          />
        )}

        {userRole === 'admin' && stage === 'roleAssignment' && (
          <RoleAssignment
            employees={employees}
            onComplete={handleRoleAssignmentComplete}
            onBack={navigationStack.length > 0 ? goBack : null}
          />
        )}

        {userRole === 'admin' && stage === 'adminDashboard' && (
          <AdminDashboard
            employees={employees}
            roleAssignments={roleAssignments}
            submittedFeedback={submittedFeedback}
            cycleId={currentCycleId}
            onStartOver={handleStartOver}
            onStartNewSurvey={handleStartNewSurvey}
            onDeleteAssignment={handleDeleteAssignment}
            competencies={EMPLOYEE_COMPETENCIES}
            onOpenReport={handleOpenReport}
          />
        )}

        {userRole === 'admin' && stage === 'employeeReport' && reportData && (
          <EmployeeReport
            employeeName={reportData.name}
            feedbacks={reportData.feedbacks}
            competencies={EMPLOYEE_COMPETENCIES}
            onBack={navigationStack.length > 0 ? goBack : null}
            onDeleteFeedback={reportData.readOnly ? undefined : handleDeleteFeedback}
          />
        )}

      </main>
    </div>
  );
}

function BackButton({ onBack }) {
  if (!onBack) return null;
  return (
    <button
      onClick={onBack}
      style={{
        background: 'none',
        border: 'none',
        color: 'var(--color-text-muted)',
        cursor: 'pointer',
        fontSize: '0.9rem',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        fontWeight: 500,
        padding: '0',
        marginBottom: '1.25rem',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
      }}
    >
      ← Назад
    </button>
  );
}

function SelectEvalueeForm({ employees, onSelect }) {
  const [selectedName, setSelectedName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selectedName) onSelect(selectedName);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label><strong>Выберите сотрудника:</strong></label>
        <select
          value={selectedName}
          onChange={(e) => setSelectedName(e.target.value)}
          className="input"
        >
          <option value="">-- Выберите из списка --</option>
          {employees.map((name, idx) => (
            <option key={idx} value={name}>{name}</option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={!selectedName}
        className="btn btn-success"
        style={{ opacity: selectedName ? 1 : 0.5 }}
      >
        Далее →
      </button>
    </form>
  );
}

export default App;
