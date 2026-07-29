import { getAdminAuth, getAdminDb, FieldValue, SUPERADMIN_EMAIL } from './_lib/firebaseAdmin.mjs';

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

  const { idToken, email, password, companyName } = body;

  if (!idToken || !email || !password || !companyName) {
    res.status(400).json({ error: 'Заполните все поля' });
    return;
  }

  let adminAuth;
  let db;
  try {
    adminAuth = getAdminAuth();
    db = getAdminDb();
  } catch (err) {
    console.error('[create-client] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Серверная конфигурация не настроена. Обратитесь к администратору.' });
    return;
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (err) {
    console.error('[create-client] idToken verification failed:', err.message);
    res.status(401).json({ error: 'Не удалось подтвердить личность. Войдите заново.' });
    return;
  }

  if (decoded.email !== SUPERADMIN_EMAIL) {
    res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    return;
  }

  let userRecord;
  try {
    userRecord = await adminAuth.createUser({
      email,
      password,
      displayName: companyName,
    });
  } catch (err) {
    console.error('[create-client] createUser failed:', err.code, err.message);
    const message = err.code === 'auth/email-already-exists'
      ? 'Пользователь с таким email уже существует.'
      : err.code === 'auth/invalid-password'
        ? 'Пароль слишком короткий (минимум 6 символов).'
        : err.code === 'auth/invalid-email'
          ? 'Некорректный email.'
          : 'Не удалось создать клиента.';
    res.status(400).json({ error: message });
    return;
  }

  try {
    await db.collection('clients').doc(userRecord.uid).set({
      uid: userRecord.uid,
      email,
      companyName,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[create-client] Failed to write client record:', err);
    res.status(500).json({ error: 'Клиент создан в Firebase Auth, но не удалось сохранить запись. Обратитесь к разработчику.' });
    return;
  }

  res.status(200).json({ uid: userRecord.uid });
}
