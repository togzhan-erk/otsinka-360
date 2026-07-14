import React, { useState, useCallback, useEffect } from 'react';
import './App.css';
import RoleSelector from './components/RoleSelector';
import RaterForm from './components/RaterForm';
import ThankYouScreen from './components/ThankYouScreen';
import AdminUpload from './components/AdminUpload';
import RoleAssignment from './components/RoleAssignment';
import AdminDashboard from './components/AdminDashboard';
import { db } from './firebase';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

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

  // On first load: if invite params were captured at module level, load project and open RaterForm.
  useEffect(() => {
    if (!INVITE.evalueeId) return; // not an invite link

    (async () => {
      setStage('loadingRaterData');
      try {
        const snap = await getDoc(doc(db, 'projects', 'active'));
        const projectData = snap.exists() ? snap.data() : null;
        const invite = resolveInviteFromProject(projectData);

        if (invite) {
          console.log('[App] Invite resolved successfully:', invite);
          setEmployees(projectData.employees || []);
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
      const snap = await getDoc(doc(db, 'projects', 'active'));
      if (snap.exists()) {
        const data = snap.data();
        console.log('[App] Rater flow: loaded employees from Firestore:', data.employees);
        setEmployees(data.employees || []);
      } else {
        console.log('[App] Rater flow: no active project found in Firestore');
        setEmployees([]);
      }
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
      const snap = await getDoc(doc(db, 'projects', 'active'));
      if (snap.exists()) {
        const data = snap.data();
        console.log('[App] Admin flow: found existing project in Firestore:', data);
        setEmployees(data.employees || []);
        setRoleAssignments(data.roleAssignments || []);
        setStage('adminDashboard');
      } else {
        console.log('[App] Admin flow: no existing project, starting fresh');
        setStage('adminUpload');
      }
    } catch (err) {
      console.error('[App] Admin flow: error checking project:', err);
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
    console.log('[App] Admin flow: saving project to Firestore. Employees:', employeesToSave, 'Assignments:', assignments);
    try {
      await setDoc(doc(db, 'projects', 'active'), {
        employees: employeesToSave,
        roleAssignments: assignments,
        savedAt: serverTimestamp(),
      });
      console.log('[App] Admin flow: project saved to Firestore successfully');
    } catch (err) {
      console.error('[App] Admin flow: failed to save project:', err);
    }
    setNavigationStack([]);
    setStage('adminDashboard');
  };

  const handleDeleteAssignment = async (assignmentId) => {
    const filtered = roleAssignments.filter(a => a.id !== assignmentId);
    setRoleAssignments(filtered);
    try {
      await setDoc(doc(db, 'projects', 'active'), {
        employees,
        roleAssignments: filtered,
        savedAt: serverTimestamp(),
      });
      console.log('[App] Assignment deleted, project updated in Firestore');
    } catch (err) {
      console.error('[App] Failed to update project after assignment deletion:', err);
    }
  };

  const handleNewProject = async () => {
    const confirmed = window.confirm(
      'Начать новый проект оценки?\n\nТекущий список сотрудников и назначения будут удалены. Уже полученные оценки (feedback) в базе данных сохранятся.'
    );
    if (!confirmed) return;

    console.log('[App] Admin flow: user confirmed new project — deleting active project');
    try {
      await deleteDoc(doc(db, 'projects', 'active'));
      console.log('[App] Admin flow: active project deleted');
    } catch (err) {
      console.error('[App] Admin flow: failed to delete project:', err);
    }
    setNavigationStack([]);
    setUserRole(null);
    setStage('roleSelector');
    setCurrentEvaluee(null);
    setCurrentRaterType(null);
    setEmployees([]);
    setRoleAssignments([]);
    setSubmittedFeedback([]);
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
            onStartOver={handleStartOver}
            onNewProject={handleNewProject}
            onDeleteAssignment={handleDeleteAssignment}
            competencies={EMPLOYEE_COMPETENCIES}
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
