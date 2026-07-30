import React, { useState, useEffect } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  getArchivedCycles, getCycleFeedback, resumeCycle, duplicateCycle, deleteCycleCompletely,
} from '../cycles';
import { STANDARD_COMPETENCIES, TOP_COMPETENCIES, DEFAULT_TRACK } from '../competencies';
import { isSuperadmin } from '../auth';
import { LogoIcon } from './Logo';
import { listClients, createClient, setClientAccess, resetClientPassword, deleteClientAccount } from '../clients';
import EmployeesStep from './EmployeesStep';
import RoleAssignment from './RoleAssignment';
import LaunchStep from './LaunchStep';
import emailjs from '@emailjs/browser';
import * as XLSX from 'xlsx';
import {
  LayoutDashboard, Settings, Mail, BarChart3, Archive, Building2,
  Plus, LogOut, Bell, Copy, Check, CheckCircle2, Trash2, Download,
  FileText, ArrowLeft, Clock, Circle, Play, Search, Lock, Unlock, KeyRound,
  Users, ClipboardList,
} from 'lucide-react';

const BASE_URL = 'https://otsinka-360.vercel.app';

// ── Admin navbar ────────────────────────────────────────────────────────────
//
// Full-width dark-green top bar — logo, tabs, and account actions in one
// row. Purely presentational: all it needs is the tab state and a handful
// of already-computed values from AdminDashboard, passed in as props.

const NAV_TABS = [
  { key: 'overview', label: 'Главная', Icon: LayoutDashboard },
  { key: 'setup', label: 'Настройка опроса', Icon: Settings },
  { key: 'invitations', label: 'Приглашения', Icon: Mail },
  { key: 'results', label: 'Результаты', Icon: BarChart3 },
  { key: 'archive', label: 'Архив', Icon: Archive },
];

function AdminNavbar({ activeTab, onTabChange, isSuperadminUser, sentCount, totalAssignments, currentUser, onStartNewSurvey, onLogout }) {
  const tabs = isSuperadminUser
    ? [...NAV_TABS, { key: 'clients', label: 'Клиенты', Icon: Building2 }]
    : NAV_TABS;

  return (
    <div className="admin-navbar">
      <div className="admin-navbar-inner">
        <div className="admin-navbar-logo">
          <LogoIcon style={{ width: 30, height: 30, flexShrink: 0 }} />
          <span className="admin-navbar-logo-text">Growth 360</span>
        </div>

        <div className="admin-navbar-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`admin-navbar-tab ${activeTab === t.key ? 'active' : ''}`}
              onClick={() => onTabChange(t.key)}
            >
              <t.Icon size={16} strokeWidth={1.9} />
              {t.label}
              {t.key === 'invitations' && sentCount > 0 && ` (${sentCount}/${totalAssignments})`}
            </button>
          ))}
        </div>

        <div className="admin-navbar-actions">
          {currentUser?.email && <span className="admin-navbar-email">{currentUser.email}</span>}
          <button onClick={onStartNewSurvey} className="btn btn-secondary btn-sm">
            <Plus size={15} strokeWidth={2} />
            Новый опрос
          </button>
          <button onClick={onLogout} className="btn btn-ghost btn-sm">
            <LogOut size={15} strokeWidth={2} />
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminDashboard({ employees, roleAssignments, submittedFeedback, cycleId, currentUser, onStartOver, onLogout, onStartNewSurvey, onSetupComplete, onDeleteAssignment, onOpenReport, onCycleActivated }) {
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
  // Only a real company name counts here — the email fallback that used to
  // live on this variable is never shown as a title anywhere anymore (it's
  // still available separately, in the navbar, next to "Выйти").
  const companyName = currentUser?.displayName || '';

  // One title for the Home tab, no email fallback: a client with a company
  // name on file sees it as the title with the active survey named
  // underneath; someone without one (the superadmin) sees the active
  // survey's own name as the title instead.
  const homeTitle = companyName
    ? companyName
    : (cycleId ? (cycleName || 'Без названия') : 'Панель администратора');
  const homeSubtitle = !cycleId
    ? 'Активного опроса пока нет'
    : companyName
      ? `Активный опрос: ${cycleName || 'Без названия'} · ${cycleYear}`
      : `Активный опрос · ${cycleYear}`;

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
    <>
      <AdminNavbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isSuperadminUser={isSuperadminUser}
        sentCount={sentCount}
        totalAssignments={totalAssignments}
        currentUser={currentUser}
        onStartNewSurvey={() => setShowNewSurveyModal(true)}
        onLogout={onLogout}
      />
      <div className="admin-content">
        {/* ── Home ── */}
        {activeTab === 'overview' && (
          <div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem',
            }}>
              <div>
                <h3 style={{ margin: 0 }}>{homeTitle}</h3>
                <p style={{ margin: '0.35rem 0 0', color: 'var(--color-text-muted)' }}>
                  {homeSubtitle}
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

        {/* ── Setup (employees / assignments / launch) ── */}
        {activeTab === 'setup' && (
          <div>
            <h3 style={{ margin: 0 }}>Настройка опроса</h3>
            <SetupSteps
              employees={employees}
              assignments={effectiveAssignments}
              onSaveEmployees={(newEmployees, newAssignments) => onSetupComplete(newAssignments, newEmployees)}
              onSaveAssignments={(newAssignments) => onSetupComplete(newAssignments, employees)}
              onDeleteAssignment={handleDeleteAssignmentClick}
              onGoToInvitations={() => setActiveTab('invitations')}
            />
          </div>
        )}

        {/* ── Invitations ── */}
        {activeTab === 'invitations' && (
          <div>
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
          <div>
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
          <ArchiveTab
            onOpenReport={onOpenReport}
            ownerUid={currentUser?.uid}
            currentCycleId={cycleId}
            currentCycleName={cycleName}
            onCycleActivated={onCycleActivated}
            onGoToOverview={() => setActiveTab('overview')}
          />
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
        <NamePromptModal
          title="Начать новый опрос?"
          description="Текущий опрос будет перемещён в архив, результаты сохранятся."
          defaultName={defaultSurveyName()}
          confirmLabel="Начать новый опрос"
          onCancel={() => setShowNewSurveyModal(false)}
          onConfirm={(name) => {
            setShowNewSurveyModal(false);
            onStartNewSurvey(name);
            setActiveTab('setup');
          }}
        />
      )}
    </>
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

function HomeMetricCard({ icon: Icon, label, value, sub, children }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
      padding: '1.5rem', textAlign: 'center',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
        fontSize: '0.8125rem', fontWeight: 600,
        color: 'var(--color-text-muted)', marginBottom: '0.5rem',
      }}>
        {Icon && <Icon size={15} strokeWidth={2} style={{ flexShrink: 0 }} />}
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
        <HomeMetricCard icon={Users} label="Сотрудников" value={employeesCount} />
        <HomeMetricCard icon={ClipboardList} label="Назначений" value={totalAssignments} />
        <HomeMetricCard icon={CheckCircle2} label="Прошли оценку" value={`${completionPct}%`}>
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

// ── Setup steps (Сотрудники / Назначения / Запуск) ──────────────────────────
//
// Not a linear wizard — a free-navigation, always-editable management panel
// for the active cycle. Each step owns a fixed slice of the same two arrays
// (employees, assignments) and saves through the same two callbacks; there
// is no per-step local draft state, so switching steps never loses an edit.

const SETUP_STEPS = [
  {
    key: 'employees', number: 1, title: 'Сотрудники',
    hint: 'Загрузите список из Excel или добавьте вручную. Здесь же можно править данные и выбрать трек.',
  },
  {
    key: 'assignments', number: 2, title: 'Назначения',
    hint: 'Задайте, кто кого оценивает. Можно сгенерировать автоматически из оргструктуры или добавить вручную.',
  },
  {
    key: 'launch', number: 3, title: 'Запуск',
    hint: 'Проверьте перед запуском и переходите к рассылке приглашений.',
  },
];

function SetupSteps({ employees, assignments, onSaveEmployees, onSaveAssignments, onDeleteAssignment, onGoToInvitations }) {
  const [step, setStep] = useState('employees');
  const current = SETUP_STEPS.find(s => s.key === step);

  return (
    <div style={{ marginTop: '1.25rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        {SETUP_STEPS.map(s => (
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

      <h4 style={{ marginBottom: '0.35rem' }}>{current.title}</h4>
      <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>{current.hint}</p>

      {step === 'employees' && (
        <EmployeesStep employees={employees} assignments={assignments} onSave={onSaveEmployees} />
      )}
      {step === 'assignments' && (
        <RoleAssignment
          employees={employees}
          assignments={assignments}
          onSave={onSaveAssignments}
          onDeleteAssignment={onDeleteAssignment}
        />
      )}
      {step === 'launch' && (
        <LaunchStep employees={employees} assignments={assignments} onGoToInvitations={onGoToInvitations} />
      )}
    </div>
  );
}

// ── Name-prompt modal ────────────────────────────────────────────────────────
//
// Generic "type a name, confirm or cancel" dialog, shared by "+ Новый
// опрос" and Archive's "Дублировать" — same shape (title, optional warning
// description, an editable default name, a confirm button whose label
// varies by action).

function defaultSurveyName() {
  const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  return `Опрос от ${today}`;
}

function NamePromptModal({ title, description, label = 'Название:', inputType = 'text', defaultName, confirmLabel, onCancel, onConfirm }) {
  const [name, setName] = useState(defaultName);

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
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {description && (
          <p style={{ color: 'var(--color-text-muted)' }}>{description}</p>
        )}
        <div className="form-group">
          <label><strong>{label}</strong></label>
          <input
            type={inputType}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            autoFocus
          />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            className="btn btn-primary"
            onClick={() => onConfirm(name.trim() || defaultName)}
          >
            {confirmLabel}
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

function archiveSummary(cycle) {
  const employeesCount = (cycle.employees || []).length;
  const assignments = cycle.roleAssignments || [];
  const total = assignments.length;
  const completed = assignments.filter(a => a.completed).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { employeesCount, total, pct };
}

function ArchiveTab({ onOpenReport, ownerUid, currentCycleId, currentCycleName, onCycleActivated, onGoToOverview }) {
  const [cycles, setCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openCycle, setOpenCycle] = useState(null); // { id, name, employees, feedbacks, loading }
  const [duplicatingCycle, setDuplicatingCycle] = useState(null); // the cycle object, or null
  const [busyCycleId, setBusyCycleId] = useState(null); // id of a cycle mid resume/duplicate/delete

  const loadCycles = () => {
    setLoading(true);
    getArchivedCycles(ownerUid)
      .then(list => { setCycles(list); setLoading(false); setError(null); })
      .catch(err => {
        console.error('[ArchiveTab] Failed to load archived cycles:', err);
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadCycles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleResume = async (cycle) => {
    const message = currentCycleId
      ? `Возобновить опрос «${cycle.name}»? Текущий активный опрос «${currentCycleName || 'Без названия'}» будет перемещён в архив.`
      : `Сделать опрос «${cycle.name}» активным?`;
    if (!window.confirm(message)) return;

    setBusyCycleId(cycle.id);
    try {
      await resumeCycle(cycle.id, currentCycleId, ownerUid);
      onCycleActivated({ id: cycle.id, employees: cycle.employees || [], roleAssignments: cycle.roleAssignments || [] });
      onGoToOverview();
    } catch (err) {
      console.error('[ArchiveTab] Failed to resume cycle:', err);
      alert('Ошибка при возобновлении опроса: ' + err.message);
    } finally {
      setBusyCycleId(null);
      loadCycles();
    }
  };

  const handleDuplicateConfirm = async (name) => {
    const cycle = duplicatingCycle;
    setDuplicatingCycle(null);
    setBusyCycleId(cycle.id);
    try {
      const newId = await duplicateCycle(cycle, name, currentCycleId, ownerUid);
      const strippedAssignments = (cycle.roleAssignments || []).map(({ completed, completedAt, ...rest }) => rest);
      onCycleActivated({ id: newId, employees: (cycle.employees || []).map(e => ({ ...e })), roleAssignments: strippedAssignments });
      onGoToOverview();
    } catch (err) {
      console.error('[ArchiveTab] Failed to duplicate cycle:', err);
      alert('Ошибка при дублировании опроса: ' + err.message);
    } finally {
      setBusyCycleId(null);
      loadCycles();
    }
  };

  const handleDelete = async (cycle) => {
    const confirmed = window.confirm(
      `Удалить опрос «${cycle.name}» безвозвратно? Все его результаты и планы развития будут потеряны. Это действие нельзя отменить.`
    );
    if (!confirmed) return;

    setBusyCycleId(cycle.id);
    try {
      await deleteCycleCompletely(cycle.id, ownerUid);
      setCycles(prev => prev.filter(c => c.id !== cycle.id));
    } catch (err) {
      console.error('[ArchiveTab] Failed to delete cycle:', err);
      alert('Ошибка при удалении опроса: ' + err.message);
    } finally {
      setBusyCycleId(null);
    }
  };

  if (openCycle) {
    const grouped = groupFeedbackByEvaluee(openCycle.feedbacks);
    return (
      <div>
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
    <div>
      <h3 style={{ marginTop: 0, marginBottom: 0 }}>Архив опросов</h3>
      <p style={{ margin: '0.35rem 0 1.5rem', color: 'var(--color-text-muted)' }}>
        Прошлые опросы — можно открыть, возобновить, дублировать или удалить
      </p>

      {loading && <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>}

      {error && <div className="error-message">Ошибка загрузки архива: {error}</div>}

      {!loading && !error && cycles.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>Архив пуст. Здесь появятся опросы после того, как вы начнёте новый.</p>
      )}

      {!loading && cycles.map(cycle => {
        const { employeesCount, total, pct } = archiveSummary(cycle);
        const isBusy = busyCycleId === cycle.id;
        return (
          <div
            key={cycle.id}
            style={{
              padding: '1rem 1.25rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
              marginBottom: '0.75rem', background: '#fff',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: '600' }}>{cycle.name}</div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '0.15rem' }}>
                  {cycle.createdAt?.toDate ? cycle.createdAt.toDate().toLocaleDateString('ru-RU') : ''}
                </div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '0.35rem' }}>
                  {employeesCount} сотрудников · {total} назначений · {pct}% прошли оценку
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleOpenCycle(cycle)}
                  disabled={isBusy}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Открыть результаты
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleResume(cycle)}
                  disabled={isBusy}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  <Play size={15} strokeWidth={2} />
                  Возобновить
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setDuplicatingCycle(cycle)}
                  disabled={isBusy}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Дублировать
                </button>
                <button
                  className="btn btn-icon btn-danger-ghost"
                  onClick={() => handleDelete(cycle)}
                  disabled={isBusy}
                  title="Удалить опрос безвозвратно"
                >
                  <Trash2 size={16} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {duplicatingCycle && (
        <NamePromptModal
          title="Дублировать опрос?"
          description={
            currentCycleId
              ? `Создастся новый опрос со списком сотрудников и назначениями из «${duplicatingCycle.name}», без старых ответов и ИПР. Текущий активный опрос «${currentCycleName || 'Без названия'}» будет перемещён в архив.`
              : `Создастся новый опрос со списком сотрудников и назначениями из «${duplicatingCycle.name}», без старых ответов и ИПР.`
          }
          defaultName={`${duplicatingCycle.name} (копия)`}
          confirmLabel="Дублировать"
          onCancel={() => setDuplicatingCycle(null)}
          onConfirm={handleDuplicateConfirm}
        />
      )}
    </div>
  );
}

// ── Clients tab (superadmin only) ───────────────────────────────────────────

function ClientStatusBadge({ active }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '0.15rem 0.6rem',
      borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap',
      background: active ? 'rgba(63, 97, 82, 0.12)' : 'rgba(138, 126, 107, 0.15)',
      color: active ? 'var(--color-leaf)' : 'var(--color-text-muted)',
    }}>
      {active ? 'Активен' : 'Доступ закрыт'}
    </span>
  );
}

// Own small modal (not NamePromptModal — three fields, not one) for
// "Добавить клиента". Owns its own form/error/submitting state so the
// parent only needs to know when a client was successfully created.
function AddClientModal({ currentUser, onCancel, onCreated }) {
  const [form, setForm] = useState({ email: '', password: '', companyName: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const handleFieldChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!form.email.trim() || !form.password || !form.companyName.trim()) {
      setError('Заполните все поля');
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
      onCreated();
    } catch (err) {
      console.error('[AddClientModal] Failed to create client:', err);
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem',
      }}
      onClick={onCancel}
    >
      <div className="card" style={{ maxWidth: '440px', width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Новый клиент</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email:</label>
            <input type="email" className="input" value={form.email} onChange={handleFieldChange('email')} autoFocus />
          </div>
          <div className="form-group">
            <label>Пароль:</label>
            <input type="password" className="input" value={form.password} onChange={handleFieldChange('password')} />
          </div>
          <div className="form-group">
            <label>Название компании:</label>
            <input type="text" className="input" value={form.companyName} onChange={handleFieldChange('companyName')} />
          </div>

          {error && <div className="error-message">{error}</div>}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              <Plus size={16} strokeWidth={2} />
              {creating ? 'Создание...' : 'Создать клиента'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={creating}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ClientsTab({ currentUser }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [resettingPasswordFor, setResettingPasswordFor] = useState(null);
  const [busyUid, setBusyUid] = useState(null);

  const loadClients = () => {
    setLoading(true);
    currentUser.getIdToken()
      .then(idToken => listClients({ idToken }))
      .then(list => { setClients(list); setLoading(false); setError(null); })
      .catch(err => {
        console.error('[ClientsTab] Failed to load clients:', err);
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => { loadClients(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const query = search.trim().toLowerCase();
  const filteredClients = query
    ? clients.filter(c => c.companyName.toLowerCase().includes(query) || c.email.toLowerCase().includes(query))
    : clients;

  const handleToggleAccess = async (client) => {
    const currentlyActive = client.active !== false;
    const nextActive = !currentlyActive;

    if (!nextActive) {
      const confirmed = window.confirm(
        `Закрыть доступ клиенту «${client.companyName}»? Он не сможет войти, пока вы не откроете доступ снова. Данные сохранятся.`
      );
      if (!confirmed) return;
    }

    setBusyUid(client.uid);
    try {
      const idToken = await currentUser.getIdToken();
      await setClientAccess({ idToken, uid: client.uid, active: nextActive });
      setClients(prev => prev.map(c => c.uid === client.uid ? { ...c, active: nextActive } : c));
    } catch (err) {
      console.error('[ClientsTab] Failed to change client access:', err);
      alert('Ошибка при изменении доступа: ' + err.message);
    } finally {
      setBusyUid(null);
    }
  };

  const handleResetPasswordConfirm = async (newPassword) => {
    const client = resettingPasswordFor;
    setResettingPasswordFor(null);
    const trimmed = (newPassword || '').trim();
    if (trimmed.length < 6) {
      alert('Пароль должен быть не короче 6 символов.');
      return;
    }

    setBusyUid(client.uid);
    try {
      const idToken = await currentUser.getIdToken();
      await resetClientPassword({ idToken, uid: client.uid, newPassword: trimmed });
      alert(`Пароль для «${client.companyName}» обновлён. Передайте его клиенту: ${trimmed}`);
    } catch (err) {
      console.error('[ClientsTab] Failed to reset password:', err);
      alert('Ошибка при сбросе пароля: ' + err.message);
    } finally {
      setBusyUid(null);
    }
  };

  const handleDelete = async (client) => {
    const confirmed = window.confirm(
      `Удалить клиента «${client.companyName}» безвозвратно? Аккаунт входа будет удалён. Это действие нельзя отменить. Опросы клиента при этом останутся в базе данных.`
    );
    if (!confirmed) return;

    setBusyUid(client.uid);
    try {
      const idToken = await currentUser.getIdToken();
      await deleteClientAccount({ idToken, uid: client.uid });
      setClients(prev => prev.filter(c => c.uid !== client.uid));
    } catch (err) {
      console.error('[ClientsTab] Failed to delete client:', err);
      alert('Ошибка при удалении клиента: ' + err.message);
    } finally {
      setBusyUid(null);
    }
  };

  return (
    <div>
      <h3 style={{ marginTop: 0, marginBottom: 0 }}>Клиенты</h3>
      <p style={{ margin: '0.35rem 0 1.5rem', color: 'var(--color-text-muted)' }}>
        Управление доступами клиентов
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: '360px' }}>
          <Search size={15} strokeWidth={2} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input
            type="text"
            className="input"
            placeholder="Поиск по названию или email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: '2.1rem' }}
          />
        </div>
        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
          Клиентов: {clients.length}
        </span>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)} style={{ marginLeft: 'auto' }}>
          <Plus size={15} strokeWidth={2} />
          Добавить клиента
        </button>
      </div>

      {loading && <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>}

      {error && <div className="error-message">Ошибка загрузки клиентов: {error}</div>}

      {!loading && !error && clients.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>Клиентов пока нет.</p>
      )}

      {!loading && !error && clients.length > 0 && filteredClients.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)' }}>Ничего не найдено.</p>
      )}

      {!loading && filteredClients.map(c => {
        const active = c.active !== false;
        const isBusy = busyUid === c.uid;
        return (
          <div
            key={c.uid}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.9rem 1.1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
              marginBottom: '0.6rem', background: '#fff', gap: '1rem', flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontWeight: '600' }}>{c.companyName}</span>
                <ClientStatusBadge active={active} />
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>{c.email}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                {c.createdAt ? new Date(c.createdAt).toLocaleDateString('ru-RU') : ''}
                {' · '}{c.cyclesCount} {c.cyclesCount === 1 ? 'опрос' : 'опросов'}
                {' · '}{c.employeesCount} сотрудников
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleToggleAccess(c)}
                disabled={isBusy}
                style={{ whiteSpace: 'nowrap' }}
              >
                {active ? <Lock size={15} strokeWidth={2} /> : <Unlock size={15} strokeWidth={2} />}
                {active ? 'Закрыть доступ' : 'Открыть доступ'}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setResettingPasswordFor(c)}
                disabled={isBusy}
                style={{ whiteSpace: 'nowrap' }}
              >
                <KeyRound size={15} strokeWidth={2} />
                Сбросить пароль
              </button>
              <button
                className="btn btn-icon btn-danger-ghost"
                onClick={() => handleDelete(c)}
                disabled={isBusy}
                title="Удалить клиента"
              >
                <Trash2 size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        );
      })}

      {showAddModal && (
        <AddClientModal
          currentUser={currentUser}
          onCancel={() => setShowAddModal(false)}
          onCreated={() => { setShowAddModal(false); loadClients(); }}
        />
      )}

      {resettingPasswordFor && (
        <NamePromptModal
          title={`Сбросить пароль клиенту «${resettingPasswordFor.companyName}»?`}
          description="Клиент не сможет войти со старым паролем. Письмо не отправляется — передайте новый пароль клиенту лично."
          label="Новый пароль:"
          defaultName=""
          confirmLabel="Установить пароль"
          onCancel={() => setResettingPasswordFor(null)}
          onConfirm={handleResetPasswordConfirm}
        />
      )}
    </div>
  );
}

export default AdminDashboard;
