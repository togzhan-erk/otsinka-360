import { getAdminAuth, getAdminDb, SUPERADMIN_EMAIL } from './_lib/firebaseAdmin.mjs';

// Lists every HR-client record together with lightweight activity stats
// (how many cycles they've created, how many employees are in their most
// current one). Runs entirely through the Admin SDK so the superadmin can
// see stats across every client's cycles — something the client SDK could
// never do, since firestore.rules scope cycles/{cycleId} reads to their own
// ownerUid only.
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

  const { idToken } = body;
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
    console.error('[list-clients] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Серверная конфигурация не настроена. Обратитесь к администратору.' });
    return;
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (err) {
    console.error('[list-clients] idToken verification failed:', err.message);
    res.status(401).json({ error: 'Не удалось подтвердить личность. Войдите заново.' });
    return;
  }

  if (decoded.email !== SUPERADMIN_EMAIL) {
    res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    return;
  }

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
