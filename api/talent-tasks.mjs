import { getAdminDb, getSuperadminUid } from './_lib/firebaseAdmin.mjs';

// Карта талантов (Фаза 2) — список задач оценки для одного оценивающего,
// найденного по его личному токену (talentMaps/{ownerUid}.employees[].token).
// Публичный, без логина, по образцу api/rater-form.mjs — но здесь на один
// токен приходится несколько задач (самооценка + оценка каждого прямого
// подчинённого), а не одна.

const NOT_FOUND_MESSAGE = 'Ссылка недействительна или устарела.';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Метод не поддерживается' });
    return;
  }

  const { token } = req.query;
  if (!token) {
    res.status(400).json({ error: 'В ссылке не хватает параметров.' });
    return;
  }

  let db, ownerUid;
  try {
    db = getAdminDb();
    ownerUid = await getSuperadminUid();
  } catch (err) {
    console.error('[talent-tasks] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Сервис временно недоступен. Попробуйте позже.' });
    return;
  }

  try {
    const mapSnap = await db.collection('talentMaps').doc(ownerUid).get();
    if (!mapSnap.exists) {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    }
    const mapData = mapSnap.data();
    const employees = mapData.employees || [];
    const employee = employees.find((e) => e.token === token);
    if (!employee) {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    }

    const assignments = mapData.assignments || [];

    // Independence guarantee: only tasks where this employee is the RATER —
    // never their own evaluee-side data (e.g. a manager's task list never
    // includes the subordinate's self-assessment, since that task's
    // raterId is the subordinate's id, not the manager's).
    const tasks = assignments
      .filter((a) => a.raterId === employee.id)
      .map((a) => {
        const evaluee = employees.find((e) => e.id === a.evalueeId);
        return {
          id: a.id,
          type: a.type,
          evalueeName: evaluee?.fio || '',
          status: a.status || 'not_started',
        };
      });

    // Every employee always has at least a self-assessment task once
    // assignments have actually been computed and saved (see
    // TalentMapTab.jsx's persistEmployees) — so an empty result here for a
    // *found* employee almost always means the talentMaps doc's assignments
    // field is stale/missing rather than "this person genuinely has zero
    // tasks". Logged so it's visible in Vercel function logs instead of
    // silently rendering "Задач пока нет" with no way to tell why.
    if (tasks.length === 0) {
      if (assignments.length === 0) {
        console.error(
          '[talent-tasks] Employee found but assignments field is empty on talentMaps/%s — distribution was never computed/saved. employeeId=%s, token=%s',
          ownerUid, employee.id, token
        );
      } else {
        console.error(
          '[talent-tasks] Employee found but no assignment has raterId matching this employee — assignments may be stale (employee added/edited after the last save). talentMaps/%s, employeeId=%s, assignmentsCount=%d',
          ownerUid, employee.id, assignments.length
        );
      }
    }

    res.status(200).json({ raterName: employee.fio, tasks });
  } catch (err) {
    console.error('[talent-tasks] Unexpected error:', err);
    res.status(500).json({ error: 'Не удалось загрузить список задач. Попробуйте позже.' });
  }
}
