import { getAdminDb, FieldValue } from './_lib/firebaseAdmin.mjs';

const NOT_FOUND_MESSAGE = 'Ссылка недействительна или устарела.';

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

  const { cycleId, assignmentId, competencyScores, openQuestions } = body;

  if (
    !cycleId || !assignmentId ||
    !competencyScores || typeof competencyScores !== 'object' || Array.isArray(competencyScores) ||
    !openQuestions || typeof openQuestions.strength !== 'string' || typeof openQuestions.improvement !== 'string' ||
    !openQuestions.strength.trim() || !openQuestions.improvement.trim()
  ) {
    res.status(400).json({ error: 'Заполните все поля анкеты.' });
    return;
  }

  let db;
  try {
    db = getAdminDb();
  } catch (err) {
    console.error('[submit-feedback] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Сервис временно недоступен. Попробуйте позже.' });
    return;
  }

  const cycleRef = db.collection('cycles').doc(String(cycleId));

  try {
    const result = await db.runTransaction(async (tx) => {
      const cycleSnap = await tx.get(cycleRef);
      if (!cycleSnap.exists) {
        return { status: 'notFound' };
      }
      const cycle = cycleSnap.data();

      const assignments = cycle.roleAssignments || [];
      const assignment = assignments.find((a) => String(a.id) === String(assignmentId));
      if (!assignment) {
        return { status: 'notFound' };
      }

      // Never write a duplicate — if a double-click or a retry races the
      // first successful submit, just report back that it's already done.
      if (assignment.completed) {
        return { status: 'alreadyCompleted' };
      }

      const evaluee = (cycle.employees || []).find((e) => e.id === assignment.evalueeId);

      // Anonymous by design: nothing here identifies the rater — only who
      // was evaluated, in what capacity, and their answers. ownerUid is the
      // cycle's owner (the HR client), not the rater, and exists purely so
      // strict per-owner Firestore rules can scope reads to that owner.
      const feedbackRef = cycleRef.collection('feedback').doc();
      const feedbackPayload = {
        evalueeId: assignment.evalueeId,
        evalueeName: evaluee?.name || '',
        raterType: assignment.relationType || 'colleague',
        competencyScores,
        openQuestions: {
          strength: openQuestions.strength.trim(),
          improvement: openQuestions.improvement.trim(),
        },
        submittedAt: FieldValue.serverTimestamp(),
        ownerUid: cycle.ownerUid || null,
      };

      const updatedAssignments = assignments.map((a) =>
        String(a.id) === String(assignmentId)
          ? { ...a, completed: true, completedAt: new Date() }
          : a
      );

      tx.set(feedbackRef, feedbackPayload);
      tx.update(cycleRef, { roleAssignments: updatedAssignments });

      return { status: 'success' };
    });

    if (result.status === 'notFound') {
      res.status(404).json({ error: NOT_FOUND_MESSAGE });
      return;
    }
    if (result.status === 'alreadyCompleted') {
      res.status(200).json({ success: true, alreadyCompleted: true });
      return;
    }
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[submit-feedback] Unexpected error:', err);
    res.status(500).json({ error: 'Не удалось сохранить ответ. Попробуйте ещё раз.' });
  }
}
