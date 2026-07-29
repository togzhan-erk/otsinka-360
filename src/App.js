import React, { useState, useCallback, useEffect } from 'react';
import './App.css';
import RoleSelector from './components/RoleSelector';
import Logo from './components/Logo';
import RaterForm from './components/RaterForm';
import ThankYouScreen from './components/ThankYouScreen';
import AdminLogin from './components/AdminLogin';
import AdminDashboard from './components/AdminDashboard';
import EmployeeReport from './components/EmployeeReport';
import { db } from './firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import {
  migrateLegacyDataIfNeeded, migrateEmployeeTracksIfNeeded, migrateCycleOwnersIfNeeded,
  migrateSubDocOwnersIfNeeded, getActiveCycle, getCycle, saveCycleData, archiveCycle, createCycle,
} from './cycles';
import { getCompetenciesForTrack, DEFAULT_TRACK } from './competencies';
import { subscribeToAuthState, logout, isSuperadmin } from './auth';

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
  const [currentEvalueeTrack, setCurrentEvalueeTrack] = useState(DEFAULT_TRACK);
  // Set only by the invite-link path (via api/rater-form) — the server has
  // already resolved the right competency list and question labels, so
  // RaterForm doesn't need to re-derive them from a track id for that path.
  const [raterFormCompetencies, setRaterFormCompetencies] = useState(null);
  const [raterFormQuestions, setRaterFormQuestions] = useState(null);
  // undefined = auth state still resolving, null = signed out, object = signed in
  const [authUser, setAuthUser] = useState(undefined);

  // Auth state is independent of everything else — subscribe once and keep
  // it current for as long as the app is open. Rater routes never read this;
  // only the admin flow gates on it.
  useEffect(() => {
    const unsubscribe = subscribeToAuthState(setAuthUser);
    return unsubscribe;
  }, []);

  // On first load: if invite params were captured at module level, resolve
  // the right assignment and open RaterForm. This is the public, unauthenticated
  // path — it never touches Firestore directly; new-style links (cycle +
  // assignment) are resolved entirely through api/rater-form. Legacy
  // migrations only run from the admin flow now (see loadAdminDashboardData).
  useEffect(() => {
    (async () => {
      const hasNewStyleLink = INVITE.cycleId && INVITE.assignmentId;
      if (!INVITE.evalueeId && !hasNewStyleLink) return; // not an invite link

      setStage('loadingRaterData');

      if (hasNewStyleLink) {
        try {
          const res = await fetch(
            `/api/rater-form?cycleId=${encodeURIComponent(INVITE.cycleId)}&assignmentId=${encodeURIComponent(INVITE.assignmentId)}`
          );
          const data = await res.json().catch(() => ({}));

          if (!res.ok) {
            console.warn('[App] rater-form lookup failed:', data?.error);
            setStage('roleSelector');
            return;
          }

          window.history.replaceState({}, '', '/');

          if (data.alreadyCompleted) {
            setStage('raterAlreadyDone');
            return;
          }

          setCurrentCycleId(INVITE.cycleId);
          setCurrentAssignmentId(INVITE.assignmentId);
          setCurrentEvaluee(data.evalueeName);
          setCurrentRaterType(data.relationType);
          setRaterFormCompetencies(data.competencies || []);
          setRaterFormQuestions(data.openQuestions || null);
          setUserRole('rater');
          setStage('raterForm');
        } catch (err) {
          console.error('[App] Error resolving invite via rater-form:', err);
          setStage('roleSelector');
        }
        return;
      }

      // Legacy links sent before assignment ids existed on invite links —
      // fall back to the old client-side lookup so they still work.
      try {
        const cycle = (INVITE.cycleId ? await getCycle(INVITE.cycleId) : null) || await getActiveCycle();
        const invite = cycle ? resolveInviteFromProject(cycle) : null;

        if (invite && cycle) {
          console.log('[App] Invite resolved successfully (legacy path):', invite, 'cycle:', cycle.id);
          setEmployees(cycle.employees || []);
          setCurrentCycleId(cycle.id);
          setCurrentAssignmentId(null);
          setCurrentEvaluee(invite.evaluee.name);
          setCurrentEvalueeTrack(invite.evaluee.track || DEFAULT_TRACK);
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

  const captureNav = () => ({ stage, userRole, currentEvaluee, currentRaterType, currentEvalueeTrack });

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
      setCurrentEvalueeTrack(snap.currentEvalueeTrack || DEFAULT_TRACK);
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

  const handleSelectEvaluee = (employee) => {
    pushNav();
    setCurrentEvaluee(employee.name);
    setCurrentEvalueeTrack(employee.track || DEFAULT_TRACK);
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
  // Loads the signed-in admin's own active cycle. Only called once we know
  // who's signed in — either right away (already-authenticated click) or
  // from AdminLogin's onLoggedIn once sign-in succeeds.
  const loadAdminDashboardData = async (user) => {
    setStage('checkingProject');
    try {
      await migrateLegacyDataIfNeeded();
      await migrateEmployeeTracksIfNeeded();
      if (isSuperadmin(user)) {
        // Claims any pre-auth cycles (created before per-owner isolation
        // existed) for the superadmin, exactly once, without touching
        // cycles that already have an owner.
        await migrateCycleOwnersIfNeeded(user.uid);
      }
      // Propagates each cycle's ownerUid onto its feedback/ipr sub-documents
      // (separate Firestore docs, so they need their own ownerUid for
      // strict per-owner security rules) — safe to run for any admin, since
      // it only ever touches cycles that already have an owner.
      await migrateSubDocOwnersIfNeeded();
    } catch (err) {
      console.error('[App] Admin flow: migration check failed:', err);
    }
    try {
      const cycle = await getActiveCycle(user.uid);
      console.log('[App] Admin flow: active cycle:', cycle);
      setCurrentCycleId(cycle?.id || null);
      setEmployees(cycle?.employees || []);
      setRoleAssignments(cycle?.roleAssignments || []);
    } catch (err) {
      console.error('[App] Admin flow: error loading active cycle:', err);
    }
    // The dashboard shell renders regardless of whether the active cycle has
    // data yet — its tabs show their own empty states when it doesn't.
    setStage('adminDashboard');
  };

  const handleSelectAdminRole = () => {
    pushNav();
    setUserRole('admin');
    if (authUser) {
      loadAdminDashboardData(authUser);
    }
    // else: the render below shows the login screen; onLoggedIn picks up from there
  };

  const handleAdminLoggedIn = (user) => {
    loadAdminDashboardData(user);
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('[App] Logout failed:', err);
    }
    handleStartOver();
  };

  const handleSetupComplete = async (assignments, uploadedEmployees) => {
    const employeesToSave = uploadedEmployees || employees;
    setEmployees(employeesToSave);
    setRoleAssignments(assignments);
    console.log('[App] Admin flow: saving cycle data. Employees:', employeesToSave, 'Assignments:', assignments);
    try {
      await saveCycleData(currentCycleId, { employees: employeesToSave, roleAssignments: assignments });
      console.log('[App] Admin flow: cycle saved to Firestore successfully');
    } catch (err) {
      console.error('[App] Admin flow: failed to save cycle:', err);
    }
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
      const newId = await createCycle(name, authUser?.uid);
      setCurrentCycleId(newId);
      setEmployees([]);
      setRoleAssignments([]);
      console.log('[App] New cycle created:', newId);
    } catch (err) {
      console.error('[App] Failed to start new survey:', err);
      alert('Ошибка при создании нового опроса: ' + err.message);
    }
  };

  const handleOpenReport = (name, feedbacks, opts = {}) => {
    pushNav();
    setReportData({
      name,
      feedbacks,
      cycleId: opts.cycleId || currentCycleId,
      readOnly: !!opts.readOnly,
      track: opts.track || DEFAULT_TRACK,
      department: opts.department || '',
      cycleName: opts.cycleName || '',
    });
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
    setCurrentEvalueeTrack(DEFAULT_TRACK);
    setRaterFormCompetencies(null);
    setRaterFormQuestions(null);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-logo-heading">
          <Logo className="app-logo" />
        </h1>
        <p>Индивидуальный план развития на основе AI анализа</p>
      </header>

      <main className="app-main">
        {stage === 'roleSelector' && (
          <RoleSelector
            onSelectRater={handleSelectRaterRole}
            onSelectAdmin={handleSelectAdminRole}
          />
        )}

        {(stage === 'checkingProject' || stage === 'loadingRaterData' || (userRole === 'admin' && authUser === undefined)) && (
          <div className="container">
            <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '1.1rem' }}>Загрузка...</p>
            </div>
          </div>
        )}

        {userRole === 'admin' && authUser === null && (
          <AdminLogin
            onLoggedIn={handleAdminLoggedIn}
            onBack={navigationStack.length > 0 ? goBack : null}
          />
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
                employees={employees}
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
            competencies={raterFormCompetencies || getCompetenciesForTrack(currentEvalueeTrack)}
            openQuestionLabels={raterFormQuestions}
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

        {stage === 'raterAlreadyDone' && (
          <div className="container">
            <div className="card" style={{ maxWidth: '480px', textAlign: 'center' }}>
              <h2>Вы уже прошли эту оценку</h2>
              <p className="subtitle">Спасибо! Ваш ответ уже сохранён — повторно проходить оценку по этой ссылке не нужно.</p>
              <button onClick={handleStartOver} className="btn btn-primary">
                ← На главную
              </button>
            </div>
          </div>
        )}

        {userRole === 'admin' && authUser && stage === 'adminDashboard' && (
          <AdminDashboard
            employees={employees}
            roleAssignments={roleAssignments}
            submittedFeedback={submittedFeedback}
            cycleId={currentCycleId}
            currentUser={authUser}
            onStartOver={handleStartOver}
            onLogout={handleLogout}
            onStartNewSurvey={handleStartNewSurvey}
            onSetupComplete={handleSetupComplete}
            onDeleteAssignment={handleDeleteAssignment}
            onOpenReport={handleOpenReport}
          />
        )}

        {userRole === 'admin' && authUser && stage === 'employeeReport' && reportData && (
          <EmployeeReport
            employeeName={reportData.name}
            feedbacks={reportData.feedbacks}
            competencies={getCompetenciesForTrack(reportData.track)}
            track={reportData.track}
            department={reportData.department}
            cycleName={reportData.cycleName}
            cycleId={reportData.cycleId}
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
  const [selectedId, setSelectedId] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const employee = employees.find(emp => String(emp.id) === selectedId);
    if (employee) onSelect(employee);
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label><strong>Выберите сотрудника:</strong></label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="input"
        >
          <option value="">-- Выберите из списка --</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>{emp.name}</option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={!selectedId}
        className="btn btn-success"
        style={{ opacity: selectedId ? 1 : 0.5 }}
      >
        Далее →
      </button>
    </form>
  );
}

export default App;
