import React, { useState } from 'react';
import { login } from '../auth';

function BackButton({ onBack }) {
  if (!onBack) return null;
  return (
    <button
      onClick={onBack}
      style={{
        background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer',
        fontSize: '0.9rem', fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 500,
        padding: 0, marginBottom: '1.25rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
      }}
    >
      ← Назад
    </button>
  );
}

function AdminLogin({ onLoggedIn, onBack }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const credential = await login(email.trim(), password);
      onLoggedIn(credential.user);
    } catch (err) {
      console.error('[AdminLogin] Sign-in failed:', err.code, err.message);
      setError('Неверный email или пароль.');
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: '420px' }}>
        <BackButton onBack={onBack} />
        <h2>Вход в панель администратора</h2>
        <p className="subtitle">Используйте данные, выданные суперадминистратором</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email:</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              autoFocus
              required
            />
          </div>
          <div className="form-group">
            <label>Пароль:</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              required
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" className="btn btn-success" disabled={submitting}>
            {submitting ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AdminLogin;
