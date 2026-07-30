import { getAdminAuth, getAdminDb, SUPERADMIN_EMAIL } from './_lib/firebaseAdmin.mjs';

// Permanently removes a client's login account and their clients/{uid}
// directory record. Deliberately does NOT touch cycles/{cycleId} (or their
// feedback/ipr subcollections) — the client's survey history stays in the
// database even after their account is gone, exactly as requested.
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

  const { idToken, uid } = body;
  if (!idToken || !uid) {
    res.status(400).json({ error: 'Некорректные параметры запроса' });
    return;
  }

  let adminAuth;
  let db;
  try {
    adminAuth = getAdminAuth();
    db = getAdminDb();
  } catch (err) {
    console.error('[delete-client] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Серверная конфигурация не настроена. Обратитесь к администратору.' });
    return;
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (err) {
    console.error('[delete-client] idToken verification failed:', err.message);
    res.status(401).json({ error: 'Не удалось подтвердить личность. Войдите заново.' });
    return;
  }

  if (decoded.email !== SUPERADMIN_EMAIL) {
    res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    return;
  }

  try {
    await adminAuth.deleteUser(uid);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.error('[delete-client] Auth user already gone, deleting client record anyway:', uid);
    } else {
      console.error('[delete-client] deleteUser failed:', err.code, err.message);
      res.status(400).json({ error: 'Не удалось удалить аккаунт клиента.' });
      return;
    }
  }

  try {
    await db.collection('clients').doc(uid).delete();
  } catch (err) {
    console.error('[delete-client] Failed to delete client record:', err);
    res.status(500).json({ error: 'Аккаунт удалён, но не удалось удалить запись клиента. Обратитесь к разработчику.' });
    return;
  }

  res.status(200).json({ uid });
}
