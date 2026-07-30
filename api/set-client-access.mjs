import { getAdminAuth, getAdminDb, SUPERADMIN_EMAIL } from './_lib/firebaseAdmin.mjs';

// Opens or closes a client's login access: disabled in Firebase Auth (so
// they can't sign in at all) and mirrored onto clients/{uid}.active (so the
// admin panel can show the right status badge without a second round trip).
// Nothing about the client's cycles/employees/answers is touched.
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

  const { idToken, uid, active } = body;
  if (!idToken || !uid || typeof active !== 'boolean') {
    res.status(400).json({ error: 'Некорректные параметры запроса' });
    return;
  }

  let adminAuth;
  let db;
  try {
    adminAuth = getAdminAuth();
    db = getAdminDb();
  } catch (err) {
    console.error('[set-client-access] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Серверная конфигурация не настроена. Обратитесь к администратору.' });
    return;
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (err) {
    console.error('[set-client-access] idToken verification failed:', err.message);
    res.status(401).json({ error: 'Не удалось подтвердить личность. Войдите заново.' });
    return;
  }

  if (decoded.email !== SUPERADMIN_EMAIL) {
    res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    return;
  }

  try {
    await adminAuth.updateUser(uid, { disabled: !active });
  } catch (err) {
    console.error('[set-client-access] updateUser failed:', err.code, err.message);
    const message = err.code === 'auth/user-not-found'
      ? 'Клиент не найден в Firebase Auth.'
      : 'Не удалось изменить доступ клиента.';
    res.status(400).json({ error: message });
    return;
  }

  try {
    await db.collection('clients').doc(uid).set({ active }, { merge: true });
  } catch (err) {
    console.error('[set-client-access] Failed to update client record:', err);
    res.status(500).json({ error: 'Доступ изменён в Firebase Auth, но не удалось обновить запись клиента.' });
    return;
  }

  res.status(200).json({ uid, active });
}
