import { getAdminDb } from './_lib/firebaseAdmin.mjs';
import { getCompetenciesForTrack } from '../src/competencies.js';

// Static, non-personal — same two questions everyone answers regardless of
// track. Returned to the client so RaterForm is driven entirely by this
// endpoint's response rather than any hardcoded copy plus a Firestore read.
const OPEN_QUESTIONS = {
  strength: 'Что делает хорошо?',
  improvement: 'Что развивать?',
};

const NOT_FOUND_MESSAGE = 'Ссылка недействительна или устарела.';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Метод не поддерживается' });
    return;
  }

  const { cycleId, assignmentId } = req.query;

  if (!cycleId || !assignmentId) {
    res.status(400).json({ error: 'В ссылке не хватает параметров.' });
    return;
  }

  let db;
  try {
    db = getAdminDb();
  } catch (err) {
    console.error('[rater-form] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Сервис временно недоступен. Попробуйте позже.' });
    return;
  }

  try {
    const cycleSnap = await db.collection('cycles').doc(String(cycleId)).get();
    if (!cycleSnap.exists) {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    }
    const cycle = cycleSnap.data();

    const assignment = (cycle.roleAssignments || []).find(
      (a) => String(a.id) === String(assignmentId)
    );
    if (!assignment) {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    }

    const evaluee = (cycle.employees || []).find((e) => e.id === assignment.evalueeId);
    if (!evaluee) {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    }

    // Only what the form needs to render — no other employees, no other
    // assignments, no scores, no comments.
    res.status(200).json({
      evalueeName: evaluee.name,
      relationType: assignment.relationType || 'colleague',
      competencies: getCompetenciesForTrack(evaluee.track),
      openQuestions: OPEN_QUESTIONS,
      alreadyCompleted: !!assignment.completed,
    });
  } catch (err) {
    console.error('[rater-form] Unexpected error:', err);
    res.status(500).json({ error: 'Не удалось загрузить анкету. Попробуйте позже.' });
  }
}
