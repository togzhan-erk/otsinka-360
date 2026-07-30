import React, { useState, useEffect } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { getArchivedCycles, getCycleFeedback } from '../cycles';
import { STANDARD_COMPETENCIES, TOP_COMPETENCIES, DEFAULT_TRACK } from '../competencies';
import { isSuperadmin } from '../auth';
import { getClients, createClient } from '../clients';
import AdminUpload from './AdminUpload';
import RoleAssignment from './RoleAssignment';
import emailjs from '@emailjs/browser';
import * as XLSX from 'xlsx';
import {
  LayoutDashboard, Settings, Mail, BarChart3, Archive, Building2,
  Plus, LogOut, Bell, Copy, Check, CheckCircle2, Trash2, Download,
  FileText, ArrowLeft, Clock, Circle,
} from 'lucide-react';

const BASE_URL = 'https://otsinka-360.vercel.app';

function AdminDashboard({ employees, roleAssignments, submittedFeedback, cycleId, currentUser, onStartOver, onLogout, onStartNewSurvey, onSetupComplete, onDeleteAssignment, onOpenReport }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [feedbackList, setFeedbackList] = useState([]);
  const [loadingResults, setLoadingResults] = useState(true);
  const [firestoreError, setFirestoreError] = useState(null);
  const [inviteStatus, setInviteStatus] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [showNewSurveyModal, setShowNewSurveyModal] = useState(false);
  const [liveRoleAssignments, setLiveRoleAssignments] = useState(null);
  const [liveCycleName, setLiveCycleName] = useState(null);
  const [liveCycleCreatedAt, setLiveCycleCreatedAt] = useState(null);
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
      setLiveCycleCreatedAt(null);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, 'cycles', cycleId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setLiveRoleAssignments(data.roleAssignments || []);
        setLiveCycleName(data.name || '');
        setLiveCycleCreatedAt(data.createdAt || null);
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
  const cycleYear = liveCycleCreatedAt?.toDate ? liveCycleCreatedAt.toDate().getFullYear() : new Date().getFullYear();
  const hasEmployees = employees.length > 0;
  const isSuperadminUser = isSuperadmin(currentUser);
  const companyName = currentUser?.displayName || currentUser?.email || '';

  // Home status badge — three real states, no invented ones: an active
  // cycle either hasn't been set up with employees yet ("Черновик"), has
  // employees and is out collecting responses ("Идёт сбор оценок"), or
  // there's no active cycle at all yet.
  const homeStatus = !cycleId
    ? { label: 'Нет активного опроса', color: 'var(--color-text-muted)', bg: 'var(--color-surface-tint)' }
    : !hasEmployees
      ? { label: 'Черновик', color: 'var(--color-text-muted)', bg: 'var(--color-surface-tint)' }
      : { label: 'Идёт сбор оценок', color: 'var(--color-leaf)', bg: 'rgba(63, 97, 82, 0.1)' };

  const grouped = groupFeedbackByEvaluee(feedbackList);

  const goToSetup = () => setActiveTab('setup');

  return (
    <div className="container">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 style={{ margin: 0 }}>Панель администратора</h2>
            {currentUser?.email && (
              <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{currentUser.email}</p>
            )}
            {cycleName && (
              <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-muted)' }}>{cycleName}</p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowNewSurveyModal(true)}
              className="btn btn-secondary btn-sm"
            >
              <Plus size={15} strokeWidth={2} />
              Новый опрос
            </button>
            <button onClick={onLogout} className="btn btn-ghost btn-sm">
              <LogOut size={15} strokeWidth={2} />
              Выйти
            </button>
          </div>
        </div>

        <div className="admin-tabs" style={{ marginTop: '1.5rem' }}>
          <button className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
            <LayoutDashboard size={18} strokeWidth={1.75} />
            Главная
          </button>
          <button className={`tab-btn ${activeTab === 'setup' ? 'active' : ''}`} onClick={() => setActiveTab('setup')}>
            <Settings size={18} strokeWidth={1.75} />
            Настройка опроса
          </button>
          <button className={`tab-btn ${activeTab === 'invitations' ? 'active' : ''}`} onClick={() => setActiveTab('invitations')}>
            <Mail size={18} strokeWidth={1.75} />
            Приглашения {sentCount > 0 && `(${sentCount}/${totalAssignments})`}
          </button>
          <button className={`tab-btn ${activeTab === 'results' ? 'active' : ''}`} onClick={() => setActiveTab('results')}>
            <BarChart3 size={18} strokeWidth={1.75} />
            Результаты
          </button>
          <button className={`tab-btn ${activeTab === 'archive' ? 'active' : ''}`} onClick={() => setActiveTab('archive')}>
            <Archive size={18} strokeWidth={1.75} />
            Архив
          </button>
          {isSuperadminUser && (
            <button className={`tab-btn ${activeTab === 'clients' ? 'active' : ''}`} onClick={() => setActiveTab('clients')}>
              <Building2 size={18} strokeWidth={1.75} />
              Клиенты
            </button>
          )}
        </div>

        {/* ── Home ── */}
        {activeTab === 'overview' && (
          <div style={{ marginTop: '2rem' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem',
            }}>
              <div>
                <h3 style={{ margin: 0 }}>{companyName || 'Ваша компания'}</h3>
                <p style={{ margin: '0.35rem 0 0', color: 'var(--color-text-muted)' }}>
                  {cycleId
                    ? `Активный опрос: ${cycleName || 'Без названия'} · ${cycleYear}`
                    : 'Активного опроса пока нет'}
                </p>
              </div>
              <span style={{
                display: 'inline-flex', alignItems: 'center', flexShrink: 0,
                padding: '0.4rem 0.9rem', borderRadius: 999,
                fontSize: '0.82rem', fontWeight: 600,
                background: homeStatus.bg, color: homeStatus.color,
              }}>
                {homeStatus.label}
              </span>
            </div>

            {!hasEmployees ? (
              <div style={{
                padding: '3rem 1.5rem', textAlign: 'center', background: '#fff',
                border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-card)',
              }}>
                <h3 style={{ marginTop: 0 }}>Начните здесь</h3>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
                  Загрузите список сотрудников, чтобы запустить опрос
                </p>
                <button className="btn btn-primary btn-sm" onClick={goToSetup}>
                  <Settings size={15} strokeWidth={2} />
                  Перейти в настройку опроса
                </button>
              </div>
            ) : (
              <HomeSummary
                employeesCount={employees.length}
                totalAssignments={totalAssignments}
                completedCount={completedCount}
                completionPct={completionPct}
                onViewResults={() => setActiveTab('results')}
                onSendReminders={() => setActiveTab('invitations')}
              />
            )}
          </div>
        )}

        {/* ── Setup (upload employees + assign raters + tracks) ── */}
        {activeTab === 'setup' && (
          <div style={{ marginTop: '2rem' }}>
            <h3 style={{ margin: 0 }}>Настройка опроса</h3>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--color-text-muted)' }}>
              Загрузите сотрудников и назначьте, кто кого оценивает
            </p>
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
          </div>
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

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Приглашения на оценку</h3>
                    <p style={{ margin: '0.35rem 0 0', color: 'var(--color-text-muted)' }}>
                      Отправьте персональные ссылки и следите за прохождением
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {pendingCount > 0 && (
                      <button className="btn btn-secondary btn-sm" onClick={handleRemindAllPending}>
                        <Bell size={15} strokeWidth={2} />
                        Напомнить всем непрошедшим ({pendingCount})
                      </button>
                    )}
                    {totalAssignments > 0 && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleSendAll}
                        disabled={effectiveAssignments.every(a => inviteStatus[a.id] === 'sent')}
                      >
                        Отправить все
                      </button>
                    )}
                  </div>
                </div>

                {totalAssignments === 0 && (
                  <p style={{ color: 'var(--color-text-muted)' }}>Назначений нет. Перейдите во вкладку «Настройка опроса» и создайте назначения.</p>
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
                        padding: '1rem 1.1rem',
                        border: completed ? '1px solid var(--color-border)' : '1px solid rgba(193, 91, 74, 0.25)',
                        borderRadius: 'var(--radius-card)',
                        marginBottom: '0.75rem',
                        background: completed ? '#fff' : 'rgba(193, 91, 74, 0.04)',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: '600', marginBottom: '0.2rem' }}>
                          {rater.name} оценивает {evaluee.name}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <span>{rater.email} · <a href={link} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)' }}>ссылка</a></span>
                          <button
                            type="button"
                            onClick={() => handleCopyLink(assignment, link)}
                            title="Скопировать ссылку"
                            className="btn btn-ghost btn-sm"
                            style={{ padding: '0.2rem 0.6rem', fontSize: '0.78rem' }}
                          >
                            <Copy size={13} strokeWidth={2} />
                            Скопировать ссылку
                          </button>
                          {copiedId === assignment.id && (
                            <span style={{ color: 'var(--color-success)', fontSize: '0.8rem', fontWeight: '500', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              <Check size={13} strokeWidth={2.5} />
                              Скопировано
                            </span>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {completed ? (
                          <span style={{ color: 'var(--color-success)', fontSize: '0.9rem', fontWeight: '600', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                            <CheckCircle2 size={16} strokeWidth={2} />
                            Прошёл
                          </span>
                        ) : (
                          <span style={{ color: 'var(--color-danger)', fontSize: '0.9rem', fontWeight: '600' }}>
                            Не прошёл
                          </span>
                        )}
                        {status === 'sent' && <span style={{ color: 'var(--color-success)', fontSize: '0.85rem' }}>· письмо отправлено</span>}
                        {status === 'error' && <span style={{ color: 'var(--color-danger)', fontSize: '0.85rem' }}>· ошибка отправки</span>}
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleSendInvite(assignment)}
                          disabled={status === 'sending'}
                        >
                          {status === 'sending' ? 'Отправка...' : status === 'sent' ? 'Отправить снова' : 'Отправить'}
                        </button>
                        {!completed && (
                          <button
                            onClick={() => handleSendInvite(assignment, { isReminder: true })}
                            disabled={status === 'sending'}
                            title="Повторно отправить ссылку с напоминанием"
                            className="btn btn-secondary btn-sm"
                          >
                            <Bell size={14} strokeWidth={2} />
                            Напомнить
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteAssignmentClick(assignment)}
                          title="Удалить назначение"
                          className="btn btn-icon btn-danger-ghost"
                        >
                          <Trash2 size={16} strokeWidth={2} />
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Результаты оценок</h3>
                    <p style={{ margin: '0.35rem 0 0', color: 'var(--color-text-muted)' }}>
                      Отчёты по каждому сотруднику и планы развития
                    </p>
                  </div>
                  {feedbackList.length > 0 && (
                    <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}>
                      <Download size={15} strokeWidth={2} />
                      Скачать в Excel
                    </button>
                  )}
                </div>

                {loadingResults && <p style={{ color: 'var(--color-text-muted)' }}>Загрузка из Firestore...</p>}

                {firestoreError && (
                  <div className="error-message">
                    Ошибка чтения из Firestore: {firestoreError}
                    <br />
                    <small>Проверьте правила безопасности в Firebase Console → Firestore → Rules</small>
                  </div>
                )}

                {!loadingResults && !firestoreError && feedbackList.length === 0 && (
                  <p style={{ color: 'var(--color-text-muted)' }}>
                    Оценок пока нет. Они появятся здесь после того, как участники заполнят форму.
                    <br />
                    <small>Если вы только что отправили оценку — откройте DevTools (F12) → Console и проверьте логи.</small>
                  </p>
                )}

                {!loadingResults && Object.values(grouped).map(group => {
                  const emp = findEmployeeByName(employees, group.name);
                  return (
                    <EmployeeResultRow
                      key={group.name}
                      group={group}
                      onOpenReport={onOpenReport}
                      reportOpts={{ cycleId, track: emp?.track || DEFAULT_TRACK, department: emp?.department || '', cycleName }}
                    />
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* ── Archive ── */}
        {activeTab === 'archive' && (
          <ArchiveTab onOpenReport={onOpenReport} ownerUid={currentUser?.uid} />
        )}

        {/* ── Clients (superadmin only) ── */}
        {activeTab === 'clients' && isSuperadminUser && (
          <ClientsTab currentUser={currentUser} />
        )}

        <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button onClick={onStartOver} className="btn btn-ghost btn-sm">
            <ArrowLeft size={15} strokeWidth={2} />
            На главную
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
// employee's track/department are looked up by name against that cycle's
// employee list.
function findEmployeeByName(employees, evalueeName) {
  return employees.find(e => e.name === evalueeName);
}

function EmptyCycleNotice({ onGoToSetup }) {
  return (
    <div style={{
      marginTop: '1rem', padding: '2.5rem 1.5rem', textAlign: 'center',
      border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-card)',
    }}>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
        Пока нет данных. Перейдите во вкладку «Настройка опроса» и загрузите список сотрудников.
      </p>
      <button className="btn btn-primary btn-sm" onClick={onGoToSetup}>
        <Settings size={15} strokeWidth={2} />
        Перейти в настройку опроса
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
            background: pct === 100 ? 'var(--color-success)' : 'var(--color-leaf)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

// ── Home summary (metrics row + "Что дальше" checklist) ────────────────────
//
// Every number here comes straight from the active cycle's real state —
// nothing is invented. The checklist just narrates that same state as a
// sequence of steps.

function HomeMetricCard({ label, value, sub, children }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
      padding: '1.5rem', textAlign: 'center',
    }}>
      <div style={{
        fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em',
        color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: '0.5rem',
      }}>
        {label}
      </div>
      <div style={{
        fontFamily: "'Fraunces', Georgia, serif", fontSize: '2.2rem', fontWeight: 700,
        color: 'var(--color-primary)', lineHeight: 1,
      }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.35rem' }}>{sub}</div>}
      {children}
    </div>
  );
}

const CHECKLIST_STATUS_STYLE = {
  done: { Icon: CheckCircle2, color: 'var(--color-success)' },
  inProgress: { Icon: Clock, color: 'var(--color-accent)' },
  pending: { Icon: Circle, color: 'var(--color-text-muted)' },
};

function ChecklistRow({ status, text }) {
  const { Icon, color } = CHECKLIST_STATUS_STYLE[status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.55rem 0' }}>
      <Icon size={18} strokeWidth={2} style={{ color, flexShrink: 0 }} />
      <span style={{
        fontSize: '0.92rem',
        color: status === 'pending' ? 'var(--color-text-muted)' : 'var(--color-text)',
        fontWeight: status === 'done' ? 500 : 400,
      }}>
        {text}
      </span>
    </div>
  );
}

function HomeSummary({ employeesCount, totalAssignments, completedCount, completionPct, onViewResults, onSendReminders }) {
  const hasAssignments = totalAssignments > 0;
  const allDone = hasAssignments && completionPct === 100;

  const checklist = [
    {
      key: 'employees',
      status: employeesCount > 0 ? 'done' : 'pending',
      text: 'Сотрудники загружены',
    },
    {
      key: 'assignments',
      status: hasAssignments ? 'done' : 'pending',
      text: 'Назначения готовы',
    },
    {
      key: 'collecting',
      status: !hasAssignments ? 'pending' : allDone ? 'done' : 'inProgress',
      text: !hasAssignments
        ? 'Сбор оценок ещё не начат'
        : allDone
          ? `Все оценки собраны — ${completionPct}%`
          : `Идёт сбор оценок — ${completionPct}% прошли`,
    },
    {
      key: 'results',
      status: completedCount > 0 ? 'inProgress' : 'pending',
      text: 'Результаты доступны по мере прохождения',
    },
  ];

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <HomeMetricCard label="Сотрудников" value={employeesCount} />
        <HomeMetricCard label="Назначений" value={totalAssignments} />
        <HomeMetricCard label="Прошли оценку" value={`${completionPct}%`}>
          <div style={{ background: 'var(--color-border)', borderRadius: 999, height: 6, overflow: 'hidden', marginTop: '0.65rem' }}>
            <div style={{
              width: `${completionPct}%`, height: '100%', borderRadius: 999,
              background: 'var(--color-accent)', transition: 'width 0.3s ease',
            }} />
          </div>
        </HomeMetricCard>
      </div>

      <div style={{
        background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
        padding: '1.5rem',
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Что дальше</h3>
        <div>
          {checklist.map(item => (
            <ChecklistRow key={item.key} status={item.status} text={item.text} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={onViewResults}>
            Смотреть результаты
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onSendReminders}>
            Отправить напоминания
          </button>
        </div>
      </div>
    </>
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
          className="btn btn-secondary btn-sm"
          onClick={() => onOpenReport(group.name, group.feedbacks, reportOpts)}
          style={{ whiteSpace: 'nowrap' }}
        >
          <FileText size={15} strokeWidth={2} />
          Открыть полный отчёт
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
        <p style={{ color: 'var(--color-text-muted)' }}>
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
            className="btn btn-primary"
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

function ArchiveTab({ onOpenReport, ownerUid }) {
  const [cycles, setCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openCycle, setOpenCycle] = useState(null); // { id, name, employees, feedbacks, loading }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getArchivedCycles(ownerUid)
      .then(list => { if (!cancelled) { setCycles(list); setLoading(false); } })
      .catch(err => {
        console.error('[ArchiveTab] Failed to load archived cycles:', err);
        if (!cancelled) { setError(err.message); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [ownerUid]);

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
          className="btn btn-ghost btn-sm"
          style={{ marginBottom: '1.25rem' }}
        >
          <ArrowLeft size={15} strokeWidth={2} />
          Назад к архиву
        </button>
        <h3 style={{ marginTop: 0 }}>{openCycle.name} <span style={{ fontWeight: 400, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>(архив, только просмотр)</span></h3>

        {openCycle.loading && <p style={{ color: 'var(--color-text-muted)' }}>Загрузка результатов...</p>}

        {!openCycle.loading && openCycle.feedbacks.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)' }}>В этом опросе нет ответов.</p>
        )}

        {!openCycle.loading && Object.values(grouped).map(group => {
          const emp = findEmployeeByName(openCycle.employees, group.name);
          return (
            <EmployeeResultRow
              key={group.name}
              group={group}
              onOpenReport={onOpenReport}
              reportOpts={{
                cycleId: openCycle.id, readOnly: true,
                track: emp?.track || DEFAULT_TRACK, department: emp?.department || '', cycleName: openCycle.name,
              }}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ marginTop: '2rem' }}>
      <h3 style={{ marginTop: 0, marginBottom: 0 }}>Архив опросов</h3>
      <p style={{ margin: '0.35rem 0 1.5rem', color: 'var(--color-text-muted)' }}>
        Прошлые опросы — можно открыть или возобновить
      </p>

      {loading && <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>}

      {error && <div className="error-message">Ошибка загрузки архива: {error}</div>}

      {!loading && !error && cycles.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>Архив пуст. Здесь появятся опросы после того, как вы начнёте новый.</p>
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
            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              {cycle.createdAt?.toDate ? cycle.createdAt.toDate().toLocaleDateString('ru-RU') : ''}
            </div>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleOpenCycle(cycle)}
            style={{ whiteSpace: 'nowrap' }}
          >
            Открыть результаты
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Clients tab (superadmin only) ───────────────────────────────────────────

function ClientsTab({ currentUser }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ email: '', password: '', companyName: '' });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const loadClients = () => {
    setLoading(true);
    getClients()
      .then(list => { setClients(list); setLoading(false); setError(null); })
      .catch(err => {
        console.error('[ClientsTab] Failed to load clients:', err);
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => { loadClients(); }, []);

  const handleFieldChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError(null);

    if (!form.email.trim() || !form.password || !form.companyName.trim()) {
      setCreateError('Заполните все поля');
      return;
    }

    setCreating(true);
    try {
      const idToken = await currentUser.getIdToken();
      await createClient({
        idToken,
        email: form.email.trim(),
        password: form.password,
        companyName: form.companyName.trim(),
      });
      setForm({ email: '', password: '', companyName: '' });
      loadClients();
    } catch (err) {
      console.error('[ClientsTab] Failed to create client:', err);
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ marginTop: '2rem' }}>
      <h3 style={{ marginTop: 0, marginBottom: 0 }}>Клиенты</h3>
      <p style={{ margin: '0.35rem 0 1.5rem', color: 'var(--color-text-muted)' }}>
        Управление доступами клиентов
      </p>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)', padding: '1.25rem', marginBottom: '1.75rem' }}>
        <h4 style={{ marginTop: 0 }}>Новый клиент</h4>
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label>Email:</label>
            <input type="email" className="input" value={form.email} onChange={handleFieldChange('email')} />
          </div>
          <div className="form-group">
            <label>Пароль:</label>
            <input type="password" className="input" value={form.password} onChange={handleFieldChange('password')} />
          </div>
          <div className="form-group">
            <label>Название компании:</label>
            <input type="text" className="input" value={form.companyName} onChange={handleFieldChange('companyName')} />
          </div>

          {createError && <div className="error-message">{createError}</div>}

          <button type="submit" className="btn btn-primary" disabled={creating}>
            <Plus size={16} strokeWidth={2} />
            {creating ? 'Создание...' : 'Создать клиента'}
          </button>
        </form>
      </div>

      <h4>Существующие клиенты ({clients.length})</h4>

      {loading && <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>}

      {error && <div className="error-message">Ошибка загрузки клиентов: {error}</div>}

      {!loading && !error && clients.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>Клиентов пока нет.</p>
      )}

      {!loading && clients.map(c => (
        <div
          key={c.id}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.85rem 1.1rem', border: '1px solid var(--color-border)', borderRadius: '8px',
            marginBottom: '0.6rem', gap: '1rem', flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontWeight: '600' }}>{c.companyName}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{c.email}</div>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
            {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('ru-RU') : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

export default AdminDashboard;
