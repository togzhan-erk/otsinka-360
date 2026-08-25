import React, { useState } from 'react';
import { Plus, Trash2, ShieldCheck } from 'lucide-react';
import { SUPERADMIN_EMAIL } from '../auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const rowStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '0.75rem 1rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-card)',
  background: '#fff', marginBottom: '0.6rem', gap: '0.75rem', flexWrap: 'wrap',
};

// Управление доступом к карте талантов (видно и редактируется только
// суперадмину — гейт стоит на уровне TalentMapTab.jsx, этот компонент сам
// по себе ничего не проверяет). Список хранится как allowedEmails на самом
// документе карты (talentMaps/main) — редактируется здесь, вступает в силу
// сразу для firestore.rules и для api/talent.mjs (оба читают то же поле).
// Суперадмин в этот список не входит и не может быть из него удалён — у
// него доступ всегда, безусловно, по отдельному, более сильному правилу.
function TalentMapAccessPanel({ allowedEmails, onSave }) {
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const list = allowedEmails || [];

  const handleAdd = async () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) return;
    if (!EMAIL_RE.test(trimmed)) {
      setError('Некорректный email.');
      return;
    }
    if (trimmed === SUPERADMIN_EMAIL || list.includes(trimmed)) {
      setError('У этого email уже есть доступ.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave([...list, trimmed]);
      setNewEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (email) => {
    const confirmed = window.confirm(`Убрать доступ к карте талантов у ${email}?`);
    if (!confirmed) return;
    setSaving(true);
    try {
      await onSave(list.filter((e) => e !== email));
    } catch (err) {
      alert('Ошибка: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        Кто имеет доступ к карте талантов. Карта одна общая на компанию — можно выдать доступ нескольким людям, без
        правки кода.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <div style={rowStyle}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}>
            <ShieldCheck size={16} strokeWidth={2} style={{ color: 'var(--color-primary)' }} />
            {SUPERADMIN_EMAIL}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Суперадмин · доступ всегда</span>
        </div>

        {list.map((email) => (
          <div key={email} style={rowStyle}>
            <span>{email}</span>
            <button
              className="btn btn-icon btn-danger-ghost"
              title="Убрать доступ"
              onClick={() => handleRemove(email)}
              disabled={saving}
            >
              <Trash2 size={16} strokeWidth={2} />
            </button>
          </div>
        ))}

        {list.length === 0 && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Кроме суперадмина, доступа больше ни у кого нет.
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          style={{ maxWidth: '320px' }}
          type="email"
          placeholder="email@company.kz"
          value={newEmail}
          onChange={(e) => { setNewEmail(e.target.value); setError(''); }}
        />
        <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving}>
          <Plus size={15} strokeWidth={2} />
          Добавить
        </button>
      </div>
      {error && <div className="error-message" style={{ marginTop: '1rem' }}>{error}</div>}
    </div>
  );
}

export default TalentMapAccessPanel;
