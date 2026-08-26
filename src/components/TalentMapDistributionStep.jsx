import React, { useMemo, useState } from 'react';
import { ClipboardList, Save, Copy, Check } from 'lucide-react';
import emailjs from '@emailjs/browser';
import {
  computeMergedTalentAssignments, TALENT_ASSIGNMENT_SELF, TALENT_ASSIGNMENT_MANAGER,
} from '../talentAssignments';
import { buildTalentLink } from '../talentLinks';
import { SUPERADMIN_EMAIL } from '../auth';

// Тот же EmailJS-аккаунт, что и приглашения 360 (тот же Service ID и
// Public Key — process.env.REACT_APP_EMAILJS_SERVICE_ID/PUBLIC_KEY), но
// СВОЙ, отдельный шаблон, чтобы правки текста карты талантов не задевали
// прежний шаблон 360 (process.env.REACT_APP_EMAILJS_TEMPLATE_ID, см.
// AdminDashboard.jsx handleSendInvite) — эти два шаблона теперь полностью
// независимы. Письмо отправляется напрямую с клиента, без новых
// serverless-функций (лимит Vercel — см. api/).
const TALENT_MAP_EMAILJS_TEMPLATE_ID = 'template_k0715ts';

// Переменные ровно те, что ждёт template_k0715ts: to_email — получатель,
// link — его персональная ссылка на задачи оценки в карте талантов, name —
// отображаемое имя отправителя писем, email — reply-to (обе — фиксированная
// личность «HR-службы», а не e-mail конкретного администратора, нажавшего
// «Отправить»).
async function sendTalentInvite(rater, link) {
  const templateParams = {
    to_email: rater.email,
    name: 'HR-служба',
    email: SUPERADMIN_EMAIL,
    link,
  };
  await emailjs.send(
    process.env.REACT_APP_EMAILJS_SERVICE_ID,
    TALENT_MAP_EMAILJS_TEMPLATE_ID,
    templateParams,
    process.env.REACT_APP_EMAILJS_PUBLIC_KEY
  );
}

const TYPE_LABELS = {
  [TALENT_ASSIGNMENT_SELF]: 'Самооценка',
  [TALENT_ASSIGNMENT_MANAGER]: 'Оценка руководителя',
};

const STATUS_LABELS = {
  not_started: 'Не начата',
  in_progress: 'В процессе',
  completed: 'Завершена',
};

const STATUS_STYLE = {
  not_started: { color: '#B42318', bg: '#FCE8E6' },
  in_progress: { color: '#8A5A22', bg: 'rgba(226, 145, 71, 0.14)' },
  completed: { color: 'var(--color-success)', bg: 'rgba(91, 140, 110, 0.14)' },
};

const thStyle = {
  padding: '0.6rem 0.75rem', fontSize: '0.8125rem', fontWeight: 600,
  color: 'var(--color-text-muted)', textAlign: 'left',
};
const tdStyle = { padding: '0.6rem 0.75rem', verticalAlign: 'middle', fontSize: '0.88rem' };

function StatusBadge({ status }) {
  const s = status || 'not_started';
  const style = STATUS_STYLE[s] || STATUS_STYLE.not_started;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '0.15rem 0.55rem', borderRadius: 999,
      fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap',
      background: style.bg, color: style.color,
    }}>
      {STATUS_LABELS[s]}
    </span>
  );
}

function StatCard({ label, value }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
      padding: '1.25rem 1.5rem', minWidth: '160px', flex: '1 1 160px',
    }}>
      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.4rem' }}>{label}</div>
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: '2rem', fontWeight: 700, color: 'var(--color-primary)', lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

// Шаг 2 «Распределение»: превью построено на лету из текущего списка
// сотрудников, но сохраняется поверх уже накопленного прогресса
// (computeMergedTalentAssignments — см. src/talentAssignments.js), так что
// повторное нажатие «Сохранить распределение» после правки грейда не
// сбрасывает статусы уже начатых/завершённых задач. Статусы обновляются
// живьём (assignments приходит от TalentMapTab через onSnapshot) по мере
// того, как оценивающие проходят форму по своим личным ссылкам.
function TalentMapDistributionStep({ employees, assignments, onSaveAssignments }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [sendStatus, setSendStatus] = useState({}); // raterId -> 'sending' | 'sent' | 'error'
  const [sendAllSummary, setSendAllSummary] = useState(null); // { sending, sent, failed, total }

  const merged = useMemo(
    () => computeMergedTalentAssignments(employees, assignments),
    [employees, assignments]
  );
  const getEmployee = (id) => employees.find(e => e.id === id);
  const raterIds = useMemo(() => [...new Set(merged.map(a => a.raterId))], [merged]);

  const selfCount = merged.filter(a => a.type === TALENT_ASSIGNMENT_SELF).length;
  const managerCount = merged.filter(a => a.type === TALENT_ASSIGNMENT_MANAGER).length;
  const completedCount = merged.filter(a => a.status === 'completed').length;

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await onSaveAssignments(merged);
      setSaved(true);
    } catch (err) {
      console.error('[TalentMapDistributionStep] Failed to save assignments:', err);
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (raterId, link) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(raterId);
      setTimeout(() => setCopiedId(prev => (prev === raterId ? null : prev)), 2000);
    } catch (err) {
      console.error('[TalentMapDistributionStep] Clipboard copy error:', err);
    }
  };

  const handleSendOne = async (rater, link) => {
    if (!rater.email || !link) return;
    setSendStatus(prev => ({ ...prev, [rater.id]: 'sending' }));
    try {
      await sendTalentInvite(rater, link);
      setSendStatus(prev => ({ ...prev, [rater.id]: 'sent' }));
    } catch (err) {
      console.error('[TalentMapDistributionStep] EmailJS error:', err);
      setSendStatus(prev => ({ ...prev, [rater.id]: 'error' }));
    }
  };

  // Рассылает всем сотрудникам, у кого есть email и хотя бы одна задача
  // оценки (то есть присутствуют в raterIds) — остальные (без email или
  // без токена) молча пропускаются и не входят в итоговый счётчик.
  const handleSendAll = async () => {
    const targets = raterIds
      .map(getEmployee)
      .filter(r => r && r.email && r.token);

    let sent = 0;
    let failed = 0;
    setSendAllSummary({ sending: true, sent, failed, total: targets.length });

    for (const rater of targets) {
      const link = buildTalentLink(rater.token);
      setSendStatus(prev => ({ ...prev, [rater.id]: 'sending' }));
      try {
        await sendTalentInvite(rater, link);
        setSendStatus(prev => ({ ...prev, [rater.id]: 'sent' }));
        sent += 1;
      } catch (err) {
        console.error('[TalentMapDistributionStep] EmailJS error (send all):', err);
        setSendStatus(prev => ({ ...prev, [rater.id]: 'error' }));
        failed += 1;
      }
      setSendAllSummary({ sending: true, sent, failed, total: targets.length });
    }

    setSendAllSummary({ sending: false, sent, failed, total: targets.length });
  };

  if (employees.length === 0) {
    return (
      <p style={{ color: 'var(--color-text-muted)' }}>
        Сначала загрузите сотрудников на шаге «Загрузка».
      </p>
    );
  }

  const sendableCount = raterIds.map(getEmployee).filter(r => r && r.email && r.token).length;

  return (
    <div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        <StatCard label="Всего задач оценки" value={merged.length} />
        <StatCard label="Из них самооценок" value={selfCount} />
        <StatCard label="Оценок руководителей" value={managerCount} />
        <StatCard label="Завершено" value={`${completedCount} / ${merged.length}`} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
          Сохраните распределение, чтобы личные ссылки заработали, и статусы задач начали обновляться.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleSave} disabled={saving}>
            <Save size={15} strokeWidth={2} />
            {saving ? 'Сохранение...' : 'Сохранить распределение'}
          </button>
          {sendableCount > 0 && (
            <button className="btn btn-primary btn-sm" onClick={handleSendAll} disabled={!!sendAllSummary?.sending}>
              {sendAllSummary?.sending
                ? `Рассылка... (${sendAllSummary.sent + sendAllSummary.failed}/${sendAllSummary.total})`
                : `Разослать всем (${sendableCount})`}
            </button>
          )}
        </div>
      </div>

      {saved && <div className="info-message">Распределение сохранено.</div>}
      {saveError && <div className="error-message">Ошибка сохранения: {saveError}</div>}

      {sendAllSummary && !sendAllSummary.sending && (
        <div className={sendAllSummary.failed > 0 ? 'error-message' : 'info-message'}>
          Рассылка завершена: успешно отправлено — {sendAllSummary.sent}, с ошибкой — {sendAllSummary.failed}
          {' '}(всего адресатов: {sendAllSummary.total}).
        </div>
      )}

      <div style={{ overflowX: 'auto', marginBottom: '2.5rem' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--color-border)' }}>
              <th style={thStyle}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <ClipboardList size={14} strokeWidth={2} />
                  Оценивающий
                </span>
              </th>
              <th style={thStyle}>Оцениваемый</th>
              <th style={thStyle}>Тип</th>
              <th style={thStyle}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {merged.map(a => (
              <tr key={a.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                <td style={tdStyle}>{getEmployee(a.raterId)?.fio || '—'}</td>
                <td style={tdStyle}>{getEmployee(a.evalueeId)?.fio || '—'}</td>
                <td style={tdStyle}>{TYPE_LABELS[a.type]}</td>
                <td style={tdStyle}><StatusBadge status={a.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h4 style={{ marginBottom: '0.35rem' }}>Персональные ссылки для оценивающих</h4>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
          У каждого сотрудника — одна ссылка на список его задач оценки (самооценка и оценка прямых подчинённых, если есть).
        </p>
        {raterIds.map(raterId => {
          const rater = getEmployee(raterId);
          if (!rater) return null;
          const tasks = merged.filter(a => a.raterId === raterId);
          const link = rater.token ? buildTalentLink(rater.token) : null;
          return (
            <div
              key={raterId}
              style={{
                padding: '1rem 1.1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
                marginBottom: '0.75rem', background: '#fff',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem' }}>
                <strong>{rater.fio}</strong>
                {link ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleCopy(raterId, link)}>
                      {copiedId === raterId ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
                      {copiedId === raterId ? 'Скопировано' : 'Скопировать ссылку'}
                    </button>
                    {rater.email ? (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleSendOne(rater, link)}
                        disabled={sendStatus[raterId] === 'sending'}
                      >
                        {sendStatus[raterId] === 'sending' ? 'Отправка...'
                          : sendStatus[raterId] === 'sent' ? 'Отправлено ✓'
                          : sendStatus[raterId] === 'error' ? 'Ошибка, повторить'
                          : 'Отправить'}
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }} title="У сотрудника не указан email в загруженном файле">
                        Нет email
                      </span>
                    )}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Сохраните сотрудников на шаге «Загрузка», чтобы получить ссылку</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                {tasks.map(t => (
                  <span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                    {t.type === TALENT_ASSIGNMENT_SELF ? 'Самооценка' : `Оценка: ${getEmployee(t.evalueeId)?.fio || '—'}`}
                    <StatusBadge status={t.status} />
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TalentMapDistributionStep;
