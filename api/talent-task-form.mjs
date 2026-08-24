import { getAdminDb, getSuperadminUid } from './_lib/firebaseAdmin.mjs';
import { TALENT_COMPETENCIES } from '../src/talentCompetencies.js';

// Карта талантов (Фаза 2) — данные для одной конкретной задачи оценки:
// полная модель компетенций (с анкерами уровней 1..4) плюс уже сохранённый
// черновик (если оценивающий возвращается по той же ссылке), чтобы форма
// открывалась с уже проставленными ответами.

const NOT_FOUND_MESSAGE = 'Ссылка недействительна или устарела.';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Метод не поддерживается' });
    return;
  }

  const { token, taskId } = req.query;
  if (!token || !taskId) {
    res.status(400).json({ error: 'В ссылке не хватает параметров.' });
    return;
  }

  let db, ownerUid;
  try {
    db = getAdminDb();
    ownerUid = await getSuperadminUid();
  } catch (err) {
    console.error('[talent-task-form] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Сервис временно недоступен. Попробуйте позже.' });
    return;
  }

  try {
    const mapRef = db.collection('talentMaps').doc(ownerUid);
    const mapSnap = await mapRef.get();
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

    // Ownership re-checked here, not just in api/talent-tasks.mjs: a task
    // belongs to this token only if its raterId matches this employee — a
    // guessed/foreign taskId (e.g. someone else's self-assessment) is
    // reported as not found, same as an unknown one.
    const assignments = mapData.assignments || [];
    const assignment = assignments.find((a) => String(a.id) === String(taskId) && a.raterId === employee.id);
    if (!assignment) {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    }

    const evaluee = employees.find((e) => e.id === assignment.evalueeId);

    const responseSnap = await mapRef.collection('responses').doc(String(taskId)).get();
    const responseData = responseSnap.exists ? responseSnap.data() : null;

    res.status(200).json({
      evalueeName: evaluee?.fio || '',
      type: assignment.type,
      competencies: TALENT_COMPETENCIES,
      scores: responseData?.scores || {},
      examples: responseData?.examples || {},
      status: assignment.status || 'not_started',
    });
  } catch (err) {
    console.error('[talent-task-form] Unexpected error:', err);
    res.status(500).json({ error: 'Не удалось загрузить анкету. Попробуйте позже.' });
  }
}
