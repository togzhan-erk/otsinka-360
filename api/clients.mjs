import { getAdminAuth, getAdminDb, FieldValue, SUPERADMIN_EMAIL } from './_lib/firebaseAdmin.mjs';

// Управление клиентами — единый роутер серверных функций. Объединяет то,
// что раньше было пятью отдельными файлами (api/create-client.mjs,
// api/delete-client.mjs, api/list-clients.mjs,
// api/reset-client-password.mjs, api/set-client-access.mjs) в один —
// ИСКЛЮЧИТЕЛЬНО из-за лимита Vercel Hobby на 12 serverless-функций на
// деплой. Логика и защита каждой операции (проверка idToken суперадмина
// через Admin SDK перед любым действием) не менялись ни на строку —
// только перенесены в отдельные handle*-функции и вызываются по action
// вместо отдельного пути. Все действия — POST, action в теле запроса:
//   {action:'list', idToken}
//   {action:'create', idToken, email, password, companyName}
//   {action:'set-access', idToken, uid, active}
//   {action:'reset-password', idToken, uid, newPassword}
//   {action:'delete', idToken, uid}

// ─────────────────────────────────────────────────────────────────────────
// action=list (было api/list-clients.mjs)
// ─────────────────────────────────────────────────────────────────────────
// Lists every HR-client record together with lightweight activity stats
// (how many cycles they've created, how many employees are in their most
// current one). Runs entirely through the Admin SDK so the superadmin can
// see stats across every client's cycles — something the client SDK could
// never do, since firestore.rules scope cycles/{cycleId} reads to their own
// ownerUid only.
async function handleList(req, res, adminAuth, db) {
  try {
    const clientsSnap = await db.collection('clients').get();

    const clients = await Promise.all(clientsSnap.docs.map(async (clientDoc) => {
      const data = clientDoc.data();
      const uid = clientDoc.id;

      let cyclesCount = 0;
      let employeesCount = 0;
      try {
        const cyclesSnap = await db.collection('cycles').where('ownerUid', '==', uid).get();
        cyclesCount = cyclesSnap.size;

        let currentCycle = cyclesSnap.docs.find(d => d.data().status === 'active');
        if (!currentCycle && cyclesSnap.docs.length > 0) {
          currentCycle = cyclesSnap.docs.reduce((latest, d) => {
            const t = d.data().createdAt?.toMillis ? d.data().createdAt.toMillis() : 0;
            const latestT = latest?.data().createdAt?.toMillis ? latest.data().createdAt.toMillis() : -1;
            return t > latestT ? d : latest;
          }, null);
        }
        employeesCount = (currentCycle?.data().employees || []).length;
      } catch (err) {
        console.error(`[list-clients] Failed to compute activity for ${uid}:`, err.message);
      }

      return {
        uid,
        email: data.email || '',
        companyName: data.companyName || '',
        active: data.active !== false,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : null,
        cyclesCount,
        employeesCount,
      };
    }));

    clients.sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });

    res.status(200).json({ clients });
  } catch (err) {
    console.error('[list-clients] Failed to list clients:', err);
    res.status(500).json({ error: 'Не удалось загрузить список клиентов.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// action=create (было api/create-client.mjs)
// ─────────────────────────────────────────────────────────────────────────
async function handleCreate(req, res, adminAuth, db, body) {
  const { email, password, companyName } = body;

  if (!email || !password || !companyName) {
    res.status(400).json({ error: 'Заполните все поля' });
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

// ─────────────────────────────────────────────────────────────────────────
// action=set-access (было api/set-client-access.mjs)
// ─────────────────────────────────────────────────────────────────────────
// Opens or closes a client's login access: disabled in Firebase Auth (so
// they can't sign in at all) and mirrored onto clients/{uid}.active (so the
// admin panel can show the right status badge without a second round trip).
// Nothing about the client's cycles/employees/answers is touched.
async function handleSetAccess(req, res, adminAuth, db, body) {
  const { uid, active } = body;
  if (!uid || typeof active !== 'boolean') {
    res.status(400).json({ error: 'Некорректные параметры запроса' });
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

// ─────────────────────────────────────────────────────────────────────────
// action=reset-password (было api/reset-client-password.mjs)
// ─────────────────────────────────────────────────────────────────────────
// Sets a client's password directly (no reset email) — the superadmin picks
// the new password and hands it to the client out of band.
async function handleResetPassword(req, res, adminAuth, db, body) {
  const { uid, newPassword } = body;
  if (!uid || !newPassword) {
    res.status(400).json({ error: 'Некорректные параметры запроса' });
    return;
  }
  if (newPassword.length < 6) {
    res.status(400).json({ error: 'Пароль слишком короткий (минимум 6 символов).' });
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

// ─────────────────────────────────────────────────────────────────────────
// action=delete (было api/delete-client.mjs)
// ─────────────────────────────────────────────────────────────────────────
// Permanently removes a client's login account and their clients/{uid}
// directory record. Deliberately does NOT touch cycles/{cycleId} (or their
// feedback/ipr subcollections) — the client's survey history stays in the
// database even after their account is gone, exactly as requested.
async function handleDelete(req, res, adminAuth, db, body) {
  const { uid } = body;
  if (!uid) {
    res.status(400).json({ error: 'Некорректные параметры запроса' });
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

// ─────────────────────────────────────────────────────────────────────────
// Router — every action here is superadmin-only, so the idToken check
// (verifyIdToken + email === SUPERADMIN_EMAIL) is done ONCE centrally
// before dispatching, exactly the same check every one of the five original
// files performed individually.
// ─────────────────────────────────────────────────────────────────────────
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

  const { idToken, action } = body;
  if (!idToken) {
    res.status(400).json({ error: 'Не передан idToken' });
    return;
  }

  let adminAuth;
  let db;
  try {
    adminAuth = getAdminAuth();
    db = getAdminDb();
  } catch (err) {
    console.error('[clients] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Серверная конфигурация не настроена. Обратитесь к администратору.' });
    return;
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (err) {
    console.error('[clients] idToken verification failed:', err.message);
    res.status(401).json({ error: 'Не удалось подтвердить личность. Войдите заново.' });
    return;
  }

  if (decoded.email !== SUPERADMIN_EMAIL) {
    res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    return;
  }

  if (action === 'list') {
    await handleList(req, res, adminAuth, db);
    return;
  }
  if (action === 'create') {
    await handleCreate(req, res, adminAuth, db, body);
    return;
  }
  if (action === 'set-access') {
    await handleSetAccess(req, res, adminAuth, db, body);
    return;
  }
  if (action === 'reset-password') {
    await handleResetPassword(req, res, adminAuth, db, body);
    return;
  }
  if (action === 'delete') {
    await handleDelete(req, res, adminAuth, db, body);
    return;
  }

  res.status(400).json({ error: 'Неизвестное действие' });
}
