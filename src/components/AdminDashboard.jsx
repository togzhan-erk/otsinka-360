import React, { useState, useEffect } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { getArchivedCycles, getCycleFeedback } from '../cycles';
import { STANDARD_COMPETENCIES, TOP_COMPETENCIES, DEFAULT_TRACK } from '../competencies';
import AdminUpload from './AdminUpload';
import RoleAssignment from './RoleAssignment';
import emailjs from '@emailjs/browser';
import * as XLSX from 'xlsx';

const BASE_URL = 'https://otsinka-360.vercel.app';

function AdminDashboard({ employees, roleAssignments, submittedFeedback, cycleId, onStartOver, onStartNewSurvey, onSetupComplete, onDeleteAssignment, onOpenReport }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [feedbackList, setFeedbackList] = useState([]);
  const [loadingResults, setLoadingResults] = useState(true);
  const [firestoreError, setFirestoreError] = useState(null);
  const [inviteStatus, setInviteStatus] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [showNewSurveyModal, setShowNewSurveyModal] = useState(false);
  const [liveRoleAssignments, setLiveRoleAssignments] = useState(null);
  const [liveCycleName, setLiveCycleName] = useState(null);
  const [setupUploadedEmployees, setSetupUploadedEmployees] = useState(null);

  useEffect(() => {
    if (!cycleId) {
      setLoadingResults(false);
      return;
    }
    setLoadingResults(true);
    const unsubscribe = onSnapshot(
      collection(db, 'cycles', cycleId, 'feedback'),
      (snapshot) => {
        const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        console.log('[AdminDashboard] Received', data.length, 'feedback docs for cycle', cycleId);
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
  }, [cycleId]);

  // Live-subscribed so "прошёл/не прошёл" status (and the cycle name) update
  // as raters submit, without the admin needing to reload the dashboard.
  useEffect(() => {
    if (!cycleId) {
      setLiveRoleAssignments(null);
      setLiveCycleName(null);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'cycles', cycleId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLiveRoleAssignments(data.roleAssignments || []);
        setLiveCycleName(data.name || '');
      }
    });
    return unsubscribe;
  }, [cycleId]);

  const effectiveAssignments = liveRoleAssignments ?? roleAssignments;

  const getEmployee = (id) => employees.find(e => e.id === id);

  // ── Invitations ────────────────────────────────────────────────────────────
  const buildInviteLink = (assignment) => {
    const relationType = assignment.relationType || 'colleague';
    return `${BASE_URL}/?evaluee=${assignment.evalueeId}&rater=${assignment.raterId}&type=${relationType}&cycle=${cycleId}&assignment=${assignment.id}`;
  };

  const handleSendInvite = async (assignment, { isReminder = false } = {}) => {
    const rater = getEmployee(assignment.raterId);
    const evaluee = getEmployee(assignment.evalueeId);
    if (!rater || !evaluee) return;

    const link = buildInviteLink(assignment);
    const templateParams = { link, to_email: rater.email, to_name: rater.name, evaluee_name: evaluee.name };
    if (isReminder) {
      // Extra params are harmless if the current EmailJS template doesn't
      // reference them yet — it just sends the same invite text either way.
      templateParams.reminder_message = 'Напоминаем: пожалуйста, пройдите оценку по ссылке ниже.';
      templateParams.is_reminder = 'true';
    }

    console.log('[AdminDashboard] Sending', isReminder ? 'reminder' : 'invite', 'to', rater.email, 'link:', link);
    setInviteStatus(prev => ({ ...prev, [assignment.id]: 'sending' }));

    try {
      await emailjs.send(
        process.env.REACT_APP_EMAILJS_SERVICE_ID,
        process.env.REACT_APP_EMAILJS_TEMPLATE_ID,
        templateParams,
        process.env.REACT_APP_EMAILJS_PUBLIC_KEY
      );
      console.log('[AdminDashboard] Sent to', rater.email);
      setInviteStatus(prev => ({ ...prev, [assignment.id]: 'sent' }));
    } catch (err) {
      console.error('[AdminDashboard] EmailJS error:', err);
      setInviteStatus(prev => ({ ...prev, [assignment.id]: 'error' }));
    }
  };

  const handleSendAll = async () => {
    const pending = effectiveAssignments.filter(a => inviteStatus[a.id] !== 'sent');
    for (const assignment of pending) {
      await handleSendInvite(assignment);
    }
  };

  const handleRemindAllPending = async () => {
    const pending = effectiveAssignments.filter(a => !a.completed);
    for (const assignment of pending) {
      await handleSendInvite(assignment, { isReminder: true });
    }
  };

  const handleCopyLink = async (assignment, link) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(assignment.id);
      setTimeout(() => {
        setCopiedId(prev => (prev === assignment.id ? null : prev));
      }, 2000);
    } catch (err) {
      console.error('[AdminDashboard] Clipboard copy error:', err);
    }
  };

  const handleDeleteAssignmentClick = (assignment) => {
    const rater = getEmployee(assignment.raterId);
    const evaluee = getEmployee(assignment.evalueeId);
    const confirmed = window.confirm(
      `Удалить назначение?\n\n${rater?.name} оценивает ${evaluee?.name}\n\nЭто действие необратимо.`
    );
    if (!confirmed) return;
    onDeleteAssignment(assignment.id);
  };

  // ── Excel export ───────────────────────────────────────────────────────────
  // Union of both tracks' competencies: a cycle can mix standard and
  // top-management employees, and each feedback doc only carries scores
  // for its own track's ids — the other track's columns are simply blank
  // for that row.
  const ALL_COMPETENCIES = [...STANDARD_COMPETENCIES, ...TOP_COMPETENCIES];

  const handleExportExcel = () => {
    if (feedbackList.length === 0) return;

    const compNames = ALL_COMPETENCIES.map(c => c.name);
    const header = [
      'ФИО оцениваемого',
      'Тип отношений',
      ...compNames,
      'Что делает хорошо',
      'Что развивать',
      'Дата прохождения',
    ];

    const rows = feedbackList.map(f => {
      const scores = ALL_COMPETENCIES.map(c => {
        return f.competencyScores?.[c.id] ?? f.competencyScores?.[String(c.id)] ?? '';
      });
      const date = f.submittedAt?.toDate
        ? f.submittedAt.toDate().toLocaleDateString('ru-RU')
        : '';
      return [
        f.evalueeName || '',
        f.raterType || '',
        ...scores,
        f.openQuestions?.strength || '',
        f.openQuestions?.improvement || '',
        date,
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    // Set column widths
    ws['!cols'] = [
      { wch: 25 }, { wch: 18 },
      ...compNames.map(() => ({ wch: 14 })),
      { wch: 50 }, { wch: 50 }, { wch: 16 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Результаты');

    const today = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
    XLSX.writeFile(wb, `Оценка360_результаты_${today}.xlsx`);
  };

  const sentCount = effectiveAssignments.filter(a => inviteStatus[a.id] === 'sent').length;
  const completedCount = effectiveAssignments.filter(a => a.completed).length;
  const totalAssignments = effectiveAssignments.length;
  const completionPct = totalAssignments > 0 ? Math.round((completedCount / totalAssignments) * 100) : 0;
  const pendingCount = totalAssignments - completedCount;
  const cycleName = liveCycleName ?? '';
  const hasEmployees = employees.length > 0;

  const grouped = groupFeedbackByEvaluee(feedbackList);

  const goToSetup = () => setActiveTab('setup');

  return (
    <div className="container">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Панель администратора</h2>
            {cycleName && (
              <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-muted)' }}>{cycleName}</p>
            )}
          </div>
          <button
            onClick={() => setShowNewSurveyModal(true)}
            className="btn btn-success"
            style={{ background: '#ff3b30' }}
          >
            + Новый опрос
          </button>
        </div>

        <div className="admin-tabs" style={{ marginTop: '1.5rem' }}>
          <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
            📊 Обзор
          </button>
          <button className={`tab-btn ${activeTab === 'setup' ? 'active' : ''}`} onClick={() => setActiveTab('setup')}>
            ⚙️ Настройка
          </button>
          <button className={`tab-btn ${activeTab === 'invitations' ? 'active' : ''}`} onClick={() => setActiveTab('invitations')}>
            ✉️ Приглашения {sentCount > 0 && `(${sentCount}/${totalAssignments})`}
          </button>
          <button className={`tab-btn ${activeTab === 'results' ? 'active' : ''}`} onClick={() => setActiveTab('results')}>
            📈 Результаты
          </button>
          <button className={`tab-btn ${activeTab === 'archive' ? 'active' : ''}`} onClick={() => setActiveTab('archive')}>
            🗄 Архив
          </button>
        </div>

        {/* ── Overview ── */}
        {activeTab === 'overview' && (
          <div style={{ marginTop: '2rem' }}>
            {!hasEmployees ? (
              <EmptyCycleNotice onGoToSetup={goToSetup} />
            ) : (
              <>
                {totalAssignments > 0 && (
                  <ProgressWidget completed={completedCount} total={totalAssignments} pct={completionPct} />
                )}
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-number">{employees.length}</div>
                    <div className="stat-label">Участников</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-number">{totalAssignments}</div>
                    <div className="stat-label">Оценок назначено</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-number">{feedbackList.length}</div>
                    <div className="stat-label">Получено ответов</div>
                  </div>
                </div>
                <div style={{ marginTop: '1.5rem' }}>
                  <h4>Сотрудники в проекте:</h4>
                  <ul style={{ paddingLeft: '1.5rem', color: '#3c3c44' }}>
                    {employees.map(emp => (
                      <li key={emp.id}>{emp.name} — {emp.email}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Setup (upload employees + assign raters + tracks) ── */}
        {activeTab === 'setup' && (
          <SetupTab
            employees={employees}
            roleAssignments={effectiveAssignments}
            uploadedEmployees={setupUploadedEmployees}
            onUpload={(emps) => setSetupUploadedEmployees(emps)}
            onBackToUpload={() => setSetupUploadedEmployees(null)}
            onAssignmentComplete={(assignments, employeesWithTracks) => {
              setSetupUploadedEmployees(null);
              onSetupComplete(assignments, employeesWithTracks);
              setActiveTab('overview');
            }}
          />
        )}

        {/* ── Invitations ── */}
        {activeTab === 'invitations' && (
          <div style={{ marginTop: '2rem' }}>
            {!hasEmployees ? (
              <EmptyCycleNotice onGoToSetup={goToSetup} />
            ) : (
              <>
                {totalAssignments > 0 && (
                  <ProgressWidget completed={completedCount} total={totalAssignments} pct={completionPct} />
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <h3 style={{ margin: 0 }}>Приглашения на оценку</h3>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {pendingCount > 0 && (
                      <button className="btn btn-secondary" onClick={handleRemindAllPending}>
                        🔔 Напомнить всем непрошедшим ({pendingCount})
                      </button>
                    )}
                    {totalAssignments > 0 && (
                      <button
                        className="btn btn-success"
                        onClick={handleSendAll}
                        disabled={effectiveAssignments.every(a => inviteStatus[a.id] === 'sent')}
                      >
                        Отправить все
                      </button>
                    )}
                  </div>
                </div>

                {totalAssignments === 0 && (
                  <p style={{ color: '#6f6f77' }}>Назначений нет. Перейдите во вкладку «Настройка» и создайте назначения.</p>
                )}

                {effectiveAssignments.map(assignment => {
                  const rater = getEmployee(assignment.raterId);
                  const evaluee = getEmployee(assignment.evalueeId);
                  if (!rater || !evaluee) return null;

                  const status = inviteStatus[assignment.id] || 'idle';
                  const link = buildInviteLink(assignment);
                  const completed = !!assignment.completed;

                  return (
                    <div
                      key={assignment.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '1rem',
                        border: completed ? '1px solid #e5e5e7' : '1px solid #f2c4b8',
                        borderRadius: '8px',
                        marginBottom: '0.75rem',
                        background: completed ? '#f0fdf4' : '#fff8f6',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: '600', marginBottom: '0.2rem' }}>
                          {rater.name} оценивает {evaluee.name}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#6f6f77', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span>{rater.email} · <a href={link} target="_blank" rel="noreferrer" style={{ color: '#0071e3' }}>ссылка</a></span>
                          <button
                            type="button"
                            onClick={() => handleCopyLink(assignment, link)}
                            title="Скопировать ссылку"
                            style={{
                              background: 'none',
                              border: '1px solid #e5e5e7',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              padding: '0.15rem 0.55rem',
                              fontSize: '0.8rem',
                              color: '#3c3c44',
                            }}
                          >
                            📋 Скопировать ссылку
                          </button>
                          {copiedId === assignment.id && (
                            <span style={{ color: '#34c759', fontSize: '0.8rem', fontWeight: '500' }}>Скопировано ✓</span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {completed ? (
                          <span style={{ color: '#34c759', fontSize: '0.9rem', fontWeight: '600' }}>Прошёл ✓</span>
                        ) : (
                          <span style={{ color: '#ff3b30', fontSize: '0.9rem', fontWeight: '600' }}>Не прошёл</span>
                        )}
                        {status === 'sent' && <span style={{ color: '#34c759', fontSize: '0.85rem' }}>· письмо отправлено</span>}
                        {status === 'error' && <span style={{ color: '#ff3b30', fontSize: '0.85rem' }}>· ошибка отправки</span>}
                        <button
                          className="btn btn-success"
                          onClick={() => handleSendInvite(assignment)}
                          disabled={status === 'sending'}
                          style={{ padding: '0.4rem 1rem', fontSize: '0.9rem', opacity: status === 'sending' ? 0.6 : 1 }}
                        >
                          {status === 'sending' ? 'Отправка...' : status === 'sent' ? 'Отправить снова' : 'Отправить'}
                        </button>
                        {!completed && (
                          <button
                            onClick={() => handleSendInvite(assignment, { isReminder: true })}
                            disabled={status === 'sending'}
                            title="Повторно отправить ссылку с напоминанием"
                            style={{
                              background: 'none',
                              border: '1px solid var(--color-accent)',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              padding: '0.4rem 0.8rem',
                              fontSize: '0.9rem',
                              color: 'var(--color-accent)',
                              opacity: status === 'sending' ? 0.6 : 1,
                            }}
                          >
                            🔔 Напомнить
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteAssignmentClick(assignment)}
                          title="Удалить назначение"
                          style={{
                            background: 'none',
                            border: '1px solid #e5e5e7',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            padding: '0.4rem 0.6rem',
                            fontSize: '1rem',
                            color: '#ff3b30',
                            lineHeight: 1,
                          }}
                        >
                          🗑
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* ── Results (current active cycle) ── */}
        {activeTab === 'results' && (
          <div style={{ marginTop: '2rem' }}>
            {!hasEmployees ? (
              <EmptyCycleNotice onGoToSetup={goToSetup} />
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0 }}>Результаты оценок</h3>
                  {feedbackList.length > 0 && (
                    <button className="btn btn-success" onClick={handleExportExcel}>
                      ⬇ Скачать в Excel
                    </button>
                  )}
                </div>

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
                  <EmployeeResultRow
                    key={group.name}
                    group={group}
                    onOpenReport={onOpenReport}
                    reportOpts={{ cycleId, track: getEmployeeTrack(employees, group.name) }}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Archive ── */}
        {activeTab === 'archive' && (
          <ArchiveTab onOpenReport={onOpenReport} />
        )}

        <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={onStartOver} className="btn btn-secondary">
            ← На главную
          </button>
        </div>
      </div>

      {showNewSurveyModal && (
        <NewSurveyModal
          onCancel={() => setShowNewSurveyModal(false)}
          onConfirm={(name) => {
            setShowNewSurveyModal(false);
            onStartNewSurvey(name);
            setActiveTab('setup');
          }}
        />
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupFeedbackByEvaluee(feedbackList) {
  return feedbackList.reduce((acc, item) => {
    const key = item.evalueeName || 'Неизвестный';
    if (!acc[key]) acc[key] = { name: key, feedbacks: [] };
    acc[key].feedbacks.push(item);
    return acc;
  }, {});
}

// Feedback docs only carry evalueeName (not a reliably real id — the manual
// no-invite-link rater flow stores the name in place of an id), so the
// employee's track is looked up by name against that cycle's employee list.
function getEmployeeTrack(employees, evalueeName) {
  return employees.find(e => e.name === evalueeName)?.track || DEFAULT_TRACK;
}

function EmptyCycleNotice({ onGoToSetup }) {
  return (
    <div style={{
      marginTop: '1rem', padding: '2.5rem 1.5rem', textAlign: 'center',
      border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-card)',
    }}>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
        Пока нет данных. Перейдите во вкладку «Настройка» и загрузите список сотрудников.
      </p>
      <button className="btn btn-primary" onClick={onGoToSetup}>
        ⚙️ Перейти в «Настройку»
      </button>
    </div>
  );
}

function ProgressWidget({ completed, total, pct }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
        <strong>Пройдено: {completed} из {total} ({pct}%)</strong>
      </div>
      <div style={{ background: 'var(--color-border)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 999,
            background: pct === 100 ? 'var(--color-success)' : 'var(--color-accent)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

function pluralizeAnswers(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'ответ';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'ответа';
  return 'ответов';
}

function EmployeeResultRow({ group, onOpenReport, reportOpts }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.25rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
        marginBottom: '0.75rem',
        background: '#fff',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <div>
        <div style={{ fontWeight: '600' }}>{group.name}</div>
        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          {group.feedbacks.length} {pluralizeAnswers(group.feedbacks.length)}
        </div>
      </div>
      {onOpenReport && (
        <button
          className="btn btn-primary"
          onClick={() => onOpenReport(group.name, group.feedbacks, reportOpts)}
          style={{ whiteSpace: 'nowrap', padding: '0.55rem 1.1rem', fontSize: '0.88rem' }}
        >
          📄 Открыть полный отчёт
        </button>
      )}
    </div>
  );
}

// ── Setup tab (upload employees → assign raters + tracks) ──────────────────
//
// Reuses AdminUpload/RoleAssignment exactly as they are — this only decides
// which of the two to show and where the result goes. Once the active cycle
// already has employees, re-running the wizard is not offered here (it would
// silently wipe already-sent invites); admins use "+ Новый опрос" instead.

function SetupTab({ employees, roleAssignments, uploadedEmployees, onUpload, onBackToUpload, onAssignmentComplete }) {
  if (uploadedEmployees) {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <RoleAssignment
          employees={uploadedEmployees}
          onComplete={onAssignmentComplete}
          onBack={onBackToUpload}
        />
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <AdminUpload onUpload={onUpload} onBack={null} />
      </div>
    );
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <h3 style={{ marginTop: 0 }}>Опрос уже настроен</h3>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Сотрудников: {employees.length}, назначений: {roleAssignments.length}.
      </p>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
        Чтобы изменить отдельные назначения — используйте вкладку «Приглашения».
        Чтобы полностью загрузить новый список — начните новый опрос кнопкой «+ Новый опрос» вверху страницы
        (текущий опрос и все его ответы сохранятся в архиве).
      </p>
    </div>
  );
}

// ── New survey modal ─────────────────────────────────────────────────────────

function defaultSurveyName() {
  const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Опрос от ${today}`;
}

function NewSurveyModal({ onCancel, onConfirm }) {
  const [name, setName] = useState(defaultSurveyName());

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem',
      }}
      onClick={onCancel}
    >
      <div
        className="card"
        style={{ maxWidth: '440px', width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>Начать новый опрос?</h3>
        <p style={{ color: 'var(--color-text-muted, #6f6f77)' }}>
          Текущий опрос будет перемещён в архив, результаты сохранятся.
        </p>
        <div className="form-group">
          <label><strong>Название нового опроса:</strong></label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            className="btn btn-success"
            onClick={() => onConfirm(name.trim() || defaultSurveyName())}
          >
            Начать новый опрос
          </button>
          <button className="btn btn-secondary" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Archive tab ──────────────────────────────────────────────────────────────

function ArchiveTab({ onOpenReport }) {
  const [cycles, setCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openCycle, setOpenCycle] = useState(null); // { id, name, employees, feedbacks, loading }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getArchivedCycles()
      .then(list => { if (!cancelled) { setCycles(list); setLoading(false); } })
      .catch(err => {
        console.error('[ArchiveTab] Failed to load archived cycles:', err);
        if (!cancelled) { setError(err.message); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, []);

  const handleOpenCycle = async (cycle) => {
    setOpenCycle({ id: cycle.id, name: cycle.name, employees: cycle.employees || [], feedbacks: [], loading: true });
    try {
      const feedbacks = await getCycleFeedback(cycle.id);
      setOpenCycle({ id: cycle.id, name: cycle.name, employees: cycle.employees || [], feedbacks, loading: false });
    } catch (err) {
      console.error('[ArchiveTab] Failed to load cycle results:', err);
      alert('Ошибка загрузки результатов архива: ' + err.message);
      setOpenCycle(null);
    }
  };

  if (openCycle) {
    const grouped = groupFeedbackByEvaluee(openCycle.feedbacks);
    return (
      <div style={{ marginTop: '2rem' }}>
        <button
          onClick={() => setOpenCycle(null)}
          style={{ background: 'none', border: 'none', color: 'var(--color-text-muted, #6f6f77)', cursor: 'pointer', fontSize: '0.9rem', padding: 0, marginBottom: '1.25rem' }}
        >
          ← Назад к архиву
        </button>
        <h3 style={{ marginTop: 0 }}>{openCycle.name} <span style={{ fontWeight: 400, fontSize: '0.85rem', color: 'var(--color-text-muted, #6f6f77)' }}>(архив, только просмотр)</span></h3>

        {openCycle.loading && <p style={{ color: '#6f6f77' }}>Загрузка результатов...</p>}

        {!openCycle.loading && openCycle.feedbacks.length === 0 && (
          <p style={{ color: '#6f6f77' }}>В этом опросе нет ответов.</p>
        )}

        {!openCycle.loading && Object.values(grouped).map(group => (
          <EmployeeResultRow
            key={group.name}
            group={group}
            onOpenReport={onOpenReport}
            reportOpts={{ cycleId: openCycle.id, readOnly: true, track: getEmployeeTrack(openCycle.employees, group.name) }}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <h3 style={{ marginTop: 0 }}>Архив опросов</h3>

      {loading && <p style={{ color: '#6f6f77' }}>Загрузка...</p>}

      {error && <div className="error-message">Ошибка загрузки архива: {error}</div>}

      {!loading && !error && cycles.length === 0 && (
        <p style={{ color: '#6f6f77' }}>Архив пуст. Здесь появятся опросы после того, как вы начнёте новый.</p>
      )}

      {!loading && cycles.map(cycle => (
        <div
          key={cycle.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '1rem 1.25rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
            marginBottom: '0.75rem', background: '#fff', gap: '1rem', flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontWeight: '600' }}>{cycle.name}</div>
            <div style={{ color: 'var(--color-text-muted, #6f6f77)', fontSize: '0.85rem' }}>
              {cycle.createdAt?.toDate ? cycle.createdAt.toDate().toLocaleDateString('ru-RU') : ''}
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => handleOpenCycle(cycle)}
            style={{ whiteSpace: 'nowrap', padding: '0.55rem 1.1rem', fontSize: '0.88rem' }}
          >
            Открыть результаты
          </button>
        </div>
      ))}
    </div>
  );
}

export default AdminDashboard;
