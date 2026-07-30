import { getAdminAuth, SUPERADMIN_EMAIL } from './_lib/firebaseAdmin.mjs';

// Sets a client's password directly (no reset email) — the superadmin picks
// the new password and hands it to the client out of band.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Метод не поддерживается' });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (err) {
    res.status(400).json({ error: 'Некорректное тело запроса' });
    return;
  }

  const { idToken, uid, newPassword } = body;
  if (!idToken || !uid || !newPassword) {
    res.status(400).json({ error: 'Некорректные параметры запроса' });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: 'Пароль слишком короткий (минимум 6 символов).' });
    return;
  }

  let adminAuth;
  try {
    adminAuth = getAdminAuth();
  } catch (err) {
    console.error('[reset-client-password] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Серверная конфигурация не настроена. Обратитесь к администратору.' });
    return;
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (err) {
    console.error('[reset-client-password] idToken verification failed:', err.message);
    res.status(401).json({ error: 'Не удалось подтвердить личность. Войдите заново.' });
    return;
  }

  if (decoded.email !== SUPERADMIN_EMAIL) {
    res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    return;
  }

  try {
    await adminAuth.updateUser(uid, { password: newPassword });
  } catch (err) {
    console.error('[reset-client-password] updateUser failed:', err.code, err.message);
    const message = err.code === 'auth/user-not-found'
      ? 'Клиент не найден в Firebase Auth.'
      : err.code === 'auth/invalid-password'
        ? 'Пароль слишком короткий (минимум 6 символов).'
        : 'Не удалось установить новый пароль.';
    res.status(400).json({ error: message });
    return;
  }

  res.status(200).json({ uid });
}
