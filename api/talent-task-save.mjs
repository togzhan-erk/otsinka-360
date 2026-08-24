import { getAdminDb, getSuperadminUid, FieldValue } from './_lib/firebaseAdmin.mjs';
import { getAllTalentIndicatorIds } from '../src/talentCompetencies.js';

// Карта талантов (Фаза 2) — сохранение ответа на задачу оценки. Один
// эндпоинт для обоих случаев: черновик по мере заполнения (finalize:false,
// без проверки полноты — можно сохранить и наполовину заполненную форму) и
// финальное завершение (finalize:true, только если пройдены обе проверки:
// все 28 индикаторов оценены, и у каждой крайней оценки — 1 или 4 — есть
// пример). Каждое сохранение перезаписывает scores/examples целиком —
// клиент всегда присылает полное текущее состояние формы, не дельту.

const NOT_FOUND_MESSAGE = 'Ссылка недействительна или устарела.';
const ALL_INDICATOR_IDS = getAllTalentIndicatorIds();

function isValidScore(v) {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

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

  const { token, taskId, scores, examples, finalize } = body;

  if (!token || !taskId || !scores || typeof scores !== 'object' || Array.isArray(scores)) {
    res.status(400).json({ error: 'Некорректные данные оценки.' });
    return;
  }
  const safeExamples = (examples && typeof examples === 'object' && !Array.isArray(examples)) ? examples : {};

  let db, ownerUid;
  try {
    db = getAdminDb();
    ownerUid = await getSuperadminUid();
  } catch (err) {
    console.error('[talent-task-save] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Сервис временно недоступен. Попробуйте позже.' });
    return;
  }

  const mapRef = db.collection('talentMaps').doc(ownerUid);
  const responseRef = mapRef.collection('responses').doc(String(taskId));

  try {
    const result = await db.runTransaction(async (tx) => {
      const mapSnap = await tx.get(mapRef);
      if (!mapSnap.exists) return { status: 'notFound' };
      const mapData = mapSnap.data();
      const employees = mapData.employees || [];
      const employee = employees.find((e) => e.token === token);
      if (!employee) return { status: 'notFound' };

      const assignments = mapData.assignments || [];
      const idx = assignments.findIndex((a) => String(a.id) === String(taskId) && a.raterId === employee.id);
      if (idx === -1) return { status: 'notFound' };

      const assignment = assignments[idx];

      // Never write over a completed assessment — a stray autosave racing
      // a just-finished submit, or a resubmit via back/forward, just reports
      // back that it's already done instead of reopening it.
      if (assignment.status === 'completed') {
        return { status: 'alreadyCompleted' };
      }

      if (finalize) {
        const missing = ALL_INDICATOR_IDS.filter((id) => !isValidScore(Number(scores[id])));
        if (missing.length > 0) {
          return { status: 'incomplete', missing };
        }
        const missingExamples = ALL_INDICATOR_IDS.filter((id) => {
          const v = Number(scores[id]);
          return (v === 1 || v === 4) && !String(safeExamples[id] || '').trim();
        });
        if (missingExamples.length > 0) {
          return { status: 'missingExamples', missingExamples };
        }
      }

      const cleanedScores = {};
      ALL_INDICATOR_IDS.forEach((id) => {
        const v = Number(scores[id]);
        if (isValidScore(v)) cleanedScores[id] = v;
      });
      const cleanedExamples = {};
      ALL_INDICATOR_IDS.forEach((id) => {
        const v = safeExamples[id];
        if (typeof v === 'string' && v.trim()) cleanedExamples[id] = v.trim();
      });

      const newStatus = finalize ? 'completed' : 'in_progress';
      const updatedAssignments = assignments.map((a, i) => {
        if (i !== idx) return a;
        const next = { ...a, status: newStatus, updatedAt: new Date() };
        if (finalize) next.completedAt = new Date();
        return next;
      });

      tx.set(
        responseRef,
        {
          assignmentId: String(taskId),
          raterId: employee.id,
          evalueeId: assignment.evalueeId,
          type: assignment.type,
          scores: cleanedScores,
          examples: cleanedExamples,
          status: newStatus,
          updatedAt: FieldValue.serverTimestamp(),
          ...(finalize ? { completedAt: FieldValue.serverTimestamp() } : {}),
          ownerUid,
        },
        { merge: true }
      );
      tx.update(mapRef, { assignments: updatedAssignments });

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
    if (result.status === 'incomplete') {
      res.status(400).json({ error: 'Заполните все пункты перед завершением.', missing: result.missing });
      return;
    }
    if (result.status === 'missingExamples') {
      res.status(400).json({
        error: 'Добавьте короткий пример для каждой крайней оценки (1 или 4).',
        missingExamples: result.missingExamples,
      });
      return;
    }
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('[talent-task-save] Unexpected error:', err);
    res.status(500).json({ error: 'Не удалось сохранить ответ. Попробуйте ещё раз.' });
  }
}
