import React from 'react';
import { ArrowRight, AlertTriangle, Users, ClipboardList } from 'lucide-react';

function pluralizeEmployees(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'сотрудника';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'сотрудников';
  return 'сотрудников';
}

function SummaryTile({ icon: Icon, label, value }) {
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
      <div style={{ fontFamily: "'Fraunces', Georgia, serif", fontSize: '2.2rem', fontWeight: 700, color: 'var(--color-primary)', lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

// Soft, non-blocking pre-flight checks — derived entirely from the current
// employees/assignments arrays, nothing new is tracked to compute these.
function LaunchStep({ employees, assignments, onGoToInvitations }) {
  const employeesWithoutRaters = employees.filter(emp =>
    !assignments.some(a => a.evalueeId === emp.id)
  );
  const employeesWithoutSelf = employees.filter(emp =>
    !assignments.some(a => a.evalueeId === emp.id && a.raterId === emp.id && a.relationType === 'self')
  );

  const warnings = [];
  if (employeesWithoutRaters.length > 0) {
    warnings.push(`У ${employeesWithoutRaters.length} ${pluralizeEmployees(employeesWithoutRaters.length)} нет ни одного оценивающего`);
  }
  if (employeesWithoutSelf.length > 0) {
    warnings.push(`У ${employeesWithoutSelf.length} ${pluralizeEmployees(employeesWithoutSelf.length)} нет самооценки`);
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <SummaryTile icon={Users} label="Сотрудников" value={employees.length} />
        <SummaryTile icon={ClipboardList} label="Назначений" value={assignments.length} />
      </div>

      {warnings.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          {warnings.map((text, i) => (
            <div
              key={i}
              style={{
                display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
                padding: '0.85rem 1rem', borderRadius: 'var(--radius-card)',
                background: '#FCEBD9', border: '1px solid rgba(226, 145, 71, 0.3)',
                color: 'var(--color-text)', marginBottom: '0.6rem', fontSize: '0.88rem',
              }}
            >
              <AlertTriangle size={16} strokeWidth={2} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: '0.1rem' }} />
              {text}
            </div>
          ))}
        </div>
      )}

      <button className="btn btn-primary btn-sm" onClick={onGoToInvitations}>
        Перейти к приглашениям
        <ArrowRight size={15} strokeWidth={2} />
      </button>
    </div>
  );
}

export default LaunchStep;
