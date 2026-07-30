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
  migrateSubDocOwnersIfNeeded, getActiveCycle, saveCycleData, archiveCycle, createCycle,
} from './cycles';
import { getCompetenciesForTrack, DEFAULT_TRACK } from './competencies';
import { subscribeToAuthState, logout, isSuperadmin } from './auth';

// Capture invite params at module load time — before any React effects run or
// history.replaceState clears the URL. This is the only safe place to read them.
// evaluee/rater/type are no longer used to resolve anything (the server
// derives them from the assignment) — kept only so an incomplete/old-style
// link is still recognized as "this was trying to be an invite link" and
// shown the invalid-link screen instead of silently falling through.
const _initialParams = new URLSearchParams(window.location.search);
const INVITE = {
  evalueeId: _initialParams.get('evaluee'),
  raterId: _initialParams.get('rater'),
  type: _initialParams.get('type'),
  cycleId: _initialParams.get('cycle'),
  assignmentId: _initialParams.get('assignment'),
};
console.log('[App] URL params captured at module load:', window.location.search, INVITE);

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
  // The server has already resolved the right competency list and question
  // labels for the invite link being opened — RaterForm is driven entirely
  // by this response, never by re-deriving anything from a track id client-side.
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
  // the assignment and open RaterForm — entirely through api/rater-form, the
  // only way anyone reaches the evaluation form. There is no manual "pick
  // anyone and evaluate them" path anymore: an incomplete or invalid link
  // (missing cycle/assignment ids, or ids that don't resolve to anything
  // real) shows the invalidLink screen instead of falling back to a picker.
  // A plain visit with no invite params at all just shows the admin entry
  // screen (roleSelector). Legacy migrations only run from the admin flow
  // now (see loadAdminDashboardData) — this path never touches Firestore.
  useEffect(() => {
    (async () => {
      const hasInviteParams = INVITE.evalueeId || INVITE.raterId || INVITE.type || INVITE.cycleId || INVITE.assignmentId;
      if (!hasInviteParams) return; // plain visit — stay on the admin entry screen

      window.history.replaceState({}, '', '/');

      if (!INVITE.cycleId || !INVITE.assignmentId) {
        console.warn('[App] Invite link missing cycle/assignment id');
        setStage('invalidLink');
        return;
      }

      setStage('loadingRaterData');
      try {
        const res = await fetch(
          `/api/rater-form?cycleId=${encodeURIComponent(INVITE.cycleId)}&assignmentId=${encodeURIComponent(INVITE.assignmentId)}`
        );
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          console.warn('[App] rater-form lookup failed:', data?.error);
          setStage('invalidLink');
          return;
        }

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
        setStage('invalidLink');
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
    if (!INVITE.evalueeId && !INVITE.cycleId && !INVITE.assignmentId) {
      window.history.replaceState({}, '', '/');
    }
    window.addEventListener('popstate', goBack);
    return () => window.removeEventListener('popstate', goBack);
  }, [goBack]);

  // ── Rater flow ─────────────────────────────────────────────────────────────
  // The only outcome a rater's submission produces client-side — invite-link
  // submissions post straight to api/submit-feedback inside RaterForm itself.
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

  // resumeCycle/duplicateCycle in ArchiveTab already flip Firestore status
  // atomically; this just points the app at the resulting cycle so the rest
  // of the UI (Настройка опроса, Приглашения, ...) treats it as active.
  const handleCycleActivated = (cycle) => {
    setCurrentCycleId(cycle.id);
    setEmployees(cycle.employees || []);
    setRoleAssignments(cycle.roleAssignments || []);
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
    setRaterFormCompetencies(null);
    setRaterFormQuestions(null);
  };

  return (
    <div className="app">
      {/* AdminDashboard renders its own full-width navbar (logo + tabs +
          actions) in place of this generic hero header — public/rater
          screens keep the plain logo header, per spec. */}
      {stage !== 'adminDashboard' && (
        <header className="app-header">
          <h1 className="app-logo-heading">
            <Logo className="app-logo" />
          </h1>
          <p>Индивидуальный план развития на основе AI анализа</p>
        </header>
      )}

      <main className={`app-main${stage === 'adminDashboard' ? ' app-main--admin' : ''}`}>
        {stage === 'roleSelector' && (
          <RoleSelector
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

        {stage === 'invalidLink' && (
          <div className="container">
            <div className="card" style={{ maxWidth: '480px', textAlign: 'center' }}>
              <h2>Ссылка недействительна</h2>
              <p className="subtitle">Пожалуйста, воспользуйтесь персональной ссылкой из письма-приглашения.</p>
            </div>
          </div>
        )}

        {userRole === 'rater' && stage === 'raterForm' && currentEvaluee && (
          <RaterForm
            evaluee={{ id: currentEvaluee, name: currentEvaluee }}
            competencies={raterFormCompetencies}
            openQuestionLabels={raterFormQuestions}
            onSubmit={handleRaterSubmitFeedback}
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
            onCycleActivated={handleCycleActivated}
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

export default App;
