import React, { useState } from 'react';
import './App.css';
import RoleSelector from './components/RoleSelector';
import RaterForm from './components/RaterForm';
import ThankYouScreen from './components/ThankYouScreen';
import AdminUpload from './components/AdminUpload';
import RoleAssignment from './components/RoleAssignment';
import AdminDashboard from './components/AdminDashboard';

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

const AVAILABLE_EMPLOYEES = [
  'Иван Петров',
  'Мария Сидорова',
  'Сергей Кузнецов',
  'Александра Волкова',
  'Николай Соколов'
];

function App() {
  const [userRole, setUserRole] = useState(null);
  const [stage, setStage] = useState('roleSelector');
  const [currentEvaluee, setCurrentEvaluee] = useState(null);
  const [currentRaterType, setCurrentRaterType] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [roleAssignments, setRoleAssignments] = useState([]);
  const [submittedFeedback, setSubmittedFeedback] = useState([]);

  const handleSelectRaterRole = () => {
    setUserRole('rater');
    setStage('selectEvaluee');
  };

  const handleSelectAdminRole = () => {
    setUserRole('admin');
    setStage('adminUpload');
  };

  const handleSelectEvaluee = (name) => {
    setCurrentEvaluee(name);
    setStage('selectRaterType');
  };

  const handleSelectRaterType = (relationType) => {
    setCurrentRaterType(relationType);
    setStage('raterForm');
  };

  const handleRaterSubmitFeedback = (feedback) => {
    setSubmittedFeedback([...submittedFeedback, feedback]);
    setStage('thankYou');
  };

  const handleAdminUploadFile = (employeesData) => {
    setEmployees(employeesData);
    setStage('roleAssignment');
  };

  const handleRoleAssignmentComplete = (assignments) => {
    setRoleAssignments(assignments);
    setStage('adminDashboard');
  };

  const handleStartOver = () => {
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

        {userRole === 'rater' && stage === 'selectEvaluee' && (
          <div className="container">
            <div className="card">
              <h2>Выберите оцениваемого</h2>
              <p className="subtitle">Кого вы будете оценивать?</p>
              
              <SelectEvalueeForm 
                employees={AVAILABLE_EMPLOYEES}
                onSelect={handleSelectEvaluee}
              />
            </div>
          </div>
        )}

        {userRole === 'rater' && stage === 'selectRaterType' && (
          <div className="container">
            <div className="card">
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
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                      {type.icon}
                    </div>
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
            evaluee={{ id: 1, name: currentEvaluee }}
            competencies={EMPLOYEE_COMPETENCIES}
            employeeType="employee"
            onSubmit={handleRaterSubmitFeedback}
            currentIndex={1}
            totalEvaluees={1}
            raterType={RELATIONSHIP_TYPES.find(t => t.value === currentRaterType)?.label}
          />
        )}

        {userRole === 'rater' && stage === 'thankYou' && (
          <ThankYouScreen onStartOver={handleStartOver} />
        )}

        {userRole === 'admin' && stage === 'adminUpload' && (
          <AdminUpload onUpload={handleAdminUploadFile} />
        )}

        {userRole === 'admin' && stage === 'roleAssignment' && (
          <RoleAssignment
            employees={employees}
            onComplete={handleRoleAssignmentComplete}
          />
        )}

        {userRole === 'admin' && stage === 'adminDashboard' && (
          <AdminDashboard
            employees={employees}
            roleAssignments={roleAssignments}
            submittedFeedback={submittedFeedback}
            onStartOver={handleStartOver}
          />
        )}
      </main>
    </div>
  );
}

function SelectEvalueeForm({ employees, onSelect }) {
  const [selectedName, setSelectedName] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (selectedName) {
      onSelect(selectedName);
    }
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
            <option key={idx} value={name}>
              {name}
            </option>
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