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

function App() {
  const [userRole, setUserRole] = useState(null);
  const [stage, setStage] = useState('roleSelector');
  const [currentEvaluee, setCurrentEvaluee] = useState(null);
  const [currentRaterType, setCurrentRaterType] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [roleAssignments, setRoleAssignments] = useState([]);
  const [submittedFeedback, setSubmittedFeedback] = useState([]);
  const [navigationStack, setNavigationStack] = useState([]);

  // Snapshot of current nav-relevant state — called synchronously in event handlers
  const captureNav = () => ({ stage, userRole, currentEvaluee, currentRaterType });

  // Push current state onto the stack and add a browser history entry
  const pushNav = () => {
    setNavigationStack(prev => [...prev, captureNav()]);
    window.history.pushState({}, '', '/');
  };

  // Restore the previous state from the stack (used by back button + browser back)
  // Uses functional updater so it's always reading fresh stack state — safe for useCallback([])
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
  }, []); // stable: only uses functional updater + stable setter refs

  // Seed browser history and wire up the browser back button
  useEffect(() => {
    window.history.replaceState({}, '', '/');
    window.addEventListener('popstate', goBack);
    return () => window.removeEventListener('popstate', goBack);
  }, [goBack]);

  // ── Rater flow ────────────────────────────────────────────────────────────
  const handleSelectRaterRole = () => {
    pushNav();
    setUserRole('rater');
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
    setNavigationStack([]); // clear history after successful submit
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
        console.log('[App] Found existing project in Firestore:', data);
        setEmployees(data.employees || []);
        setRoleAssignments(data.roleAssignments || []);
        setStage('adminDashboard');
      } else {
        console.log('[App] No existing project, starting fresh');
        setStage('adminUpload');
      }
    } catch (err) {
      console.error('[App] Error checking project:', err);
      setStage('adminUpload');
    }
  };

  const handleAdminUploadFile = (employeesData) => {
    pushNav();
    setEmployees(employeesData);
    setStage('roleAssignment');
  };

  const handleRoleAssignmentComplete = async (assignments) => {
    setRoleAssignments(assignments);
    try {
      await setDoc(doc(db, 'projects', 'active'), {
        employees,
        roleAssignments: assignments,
        savedAt: serverTimestamp(),
      });
      console.log('[App] Project saved to Firestore');
    } catch (err) {
      console.error('[App] Failed to save project:', err);
    }
    setNavigationStack([]); // clear history — dashboard has its own nav
    setStage('adminDashboard');
  };

  const handleNewProject = async () => {
    try {
      await deleteDoc(doc(db, 'projects', 'active'));
      console.log('[App] Active project deleted');
    } catch (err) {
      console.error('[App] Failed to delete project:', err);
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

        {userRole === 'admin' && stage === 'checkingProject' && (
          <div className="container">
            <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
              <p style={{ color: '#6f6f77', fontSize: '1.1rem' }}>Загрузка проекта...</p>
            </div>
          </div>
        )}

        {userRole === 'rater' && stage === 'selectEvaluee' && (
          <div className="container">
            <div className="card">
              <BackButton onBack={goBack} />
              <h2>Выберите оцениваемого</h2>
              <p className="subtitle">Кого вы будете оценивать?</p>
              <SelectEvalueeForm
                employees={employees.length > 0 ? employees.map(e => e.name) : []}
                onSelect={handleSelectEvaluee}
              />
            </div>
          </div>
        )}

        {userRole === 'rater' && stage === 'selectRaterType' && (
          <div className="container">
            <div className="card">
              <BackButton onBack={goBack} />
              <h2>Выберите тип отношения</h2>
              <p className="subtitle">Какой тип отношения у вас с {currentEvaluee}?</p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginTop: '2rem' }}>
                {RELATIONSHIP_TYPES.map(type => (
                  <button
                    key={type.value}
                    onClick={() => handleSelectRaterType(type.value)}
                    style={{
                      padding: '1.5rem',
                      border: '2px solid #e5e5e7',
                      borderRadius: '8px',
                      background: 'white',
                      cursor: 'pointer',
                      textAlign: 'center',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{type.icon}</div>
                    <div style={{ fontWeight: '600', marginBottom: '0.25rem' }}>{type.label}</div>
                    <div style={{ fontSize: '0.9rem', color: '#6f6f77' }}>{type.description}</div>
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
            onBack={goBack}
            currentIndex={1}
            totalEvaluees={1}
            raterType={RELATIONSHIP_TYPES.find(t => t.value === currentRaterType)?.label}
          />
        )}

        {userRole === 'rater' && stage === 'thankYou' && (
          <ThankYouScreen onStartOver={handleStartOver} />
        )}

        {userRole === 'admin' && stage === 'adminUpload' && (
          <AdminUpload onUpload={handleAdminUploadFile} onBack={goBack} />
        )}

        {userRole === 'admin' && stage === 'roleAssignment' && (
          <RoleAssignment
            employees={employees}
            onComplete={handleRoleAssignmentComplete}
            onBack={goBack}
          />
        )}

        {userRole === 'admin' && stage === 'adminDashboard' && (
          <AdminDashboard
            employees={employees}
            roleAssignments={roleAssignments}
            submittedFeedback={submittedFeedback}
            onStartOver={handleStartOver}
            onNewProject={handleNewProject}
            competencies={EMPLOYEE_COMPETENCIES}
          />
        )}
      </main>
    </div>
  );
}

function BackButton({ onBack }) {
  return (
    <button
      onClick={onBack}
      style={{
        background: 'none',
        border: 'none',
        color: '#6f6f77',
        cursor: 'pointer',
        fontSize: '0.95rem',
        padding: '0',
        marginBottom: '1.25rem',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.25rem',
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
