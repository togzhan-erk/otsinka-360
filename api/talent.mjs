import { getAdminAuth, getAdminDb, getSuperadminUid, FieldValue } from './_lib/firebaseAdmin.mjs';
import { TALENT_COMPETENCIES, getAllTalentIndicatorIds } from '../src/talentCompetencies.js';
import { TALENT_MAP_ALLOWED_EMAILS } from '../src/talentAccess.js';

// Карта талантов — единый роутер серверных функций модуля. Объединяет то,
// что раньше было пятью отдельными файлами (api/talent-tasks.mjs,
// api/talent-task-form.mjs, api/talent-task-save.mjs,
// api/generate-pair-comment.mjs, api/generate-talent-idp.mjs) в один —
// ИСКЛЮЧИТЕЛЬНО из-за лимита Vercel Hobby на 12 serverless-функций на
// деплой. Логика и защита каждой операции не менялись ни на строку —
// только перенесены в отдельные handle*-функции и вызываются по action
// вместо отдельного пути:
//   GET  /api/talent?action=tasks&token=...                — список задач по личному токену
//   GET  /api/talent?action=task-form&token=...&taskId=...  — данные для одной задачи
//   POST /api/talent {action:'save-task', token, taskId, scores, examples, finalize}
//   POST /api/talent {action:'generate-pair-comment', evalueeName, managerName, competencies, discrepancies}
//   POST /api/talent {action:'generate-idp', employeeName, grade, targetScore, competencies, weakest, strongest}
//   POST /api/talent {action:'map-owner-uid', idToken}
//
// action=map-owner-uid — добавлено, чтобы карта талантов была ОДНИМ общим
// документом (talentMaps/{ownerUid}) для всех email из
// TALENT_MAP_ALLOWED_EMAILS, а не отдельным документом на каждого: doc id
// всегда резолвится через getSuperadminUid() (фиксированный email-владелец
// документа), а не берётся из uid вызывающего — иначе второй разрешённый
// пользователь читал/писал бы в пустой talentMaps/{его-собственный-uid}.
//
// api/rater-form.mjs, api/submit-feedback.mjs и api/generate-ipr.mjs (360)
// НЕ трогались и остаются отдельными файлами — на них завязаны уже
// разосланные ссылки-приглашения, менять их пути нельзя.

const NOT_FOUND_MESSAGE = 'Ссылка недействительна или устарела.';
const ALL_INDICATOR_IDS = getAllTalentIndicatorIds();

function isValidScore(v) {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

// Общая для обоих AI-действий (было byte-identical в обоих исходных
// файлах) — Anthropic's content blocks обычно один { type: "text", text },
// но может быть несколько/другого типа, конкатенируем все текстовые.
function extractText(data) {
  if (!Array.isArray(data?.content)) return '';
  return data.content
    .filter((item) => typeof item?.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────
// action=tasks (было api/talent-tasks.mjs, Фаза 2) — GET
// ─────────────────────────────────────────────────────────────────────────
async function handleTasks(req, res) {
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

// ─────────────────────────────────────────────────────────────────────────
// action=task-form (было api/talent-task-form.mjs, Фаза 2) — GET
// ─────────────────────────────────────────────────────────────────────────
async function handleTaskForm(req, res) {
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

    // Ownership re-checked here, not just in handleTasks above: a task
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

// ─────────────────────────────────────────────────────────────────────────
// action=save-task (было api/talent-task-save.mjs, Фаза 2) — POST
// ─────────────────────────────────────────────────────────────────────────
async function handleSaveTask(req, res, body) {
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

// ─────────────────────────────────────────────────────────────────────────
// action=generate-pair-comment (было api/generate-pair-comment.mjs, Фаза 3) — POST
// ─────────────────────────────────────────────────────────────────────────
const PAIR_COMMENT_SYSTEM_PROMPT = "Ты — опытный HR-эксперт, который готовит руководителя к диалогу с сотрудником по итогам оценки «Карта талантов» (сравнение самооценки сотрудника и оценки его руководителя по компетенциям, шкала 1–4). Опирайся СТРОГО на переданные баллы и расхождения — ничего не выдумывай и не додумывай, не упоминай данные, которых нет во входных данных. Вопросы для интервью должны быть открытыми, дружелюбными и без обвинительного тона — их цель прояснить расхождение и прийти к общему пониманию, а не уличить сотрудника. Пиши по-русски, кратко и по-деловому, без канцелярита и общих фраз. Отвечай СТРОГО валидным JSON-объектом: без markdown-разметки, без обрамления ```json, без какого-либо текста до или после JSON.";

function parsePairCommentResponse(text) {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' &&
      (typeof parsed.summary === 'string' || Array.isArray(parsed.questions))) {
      return parsed;
    }
  } catch (err) {
    // not valid JSON — fall through to the raw-text fallback below
  }

  return text;
}

function formatPairCompetencies(list) {
  if (!Array.isArray(list) || list.length === 0) return 'нет данных';
  return list
    .map((c) => `- ${c.name}: самооценка ${c.selfAvg ?? '—'} / руководитель ${c.managerAvg ?? '—'} (шкала 1–4)`)
    .join('\n');
}

function formatDiscrepancies(list) {
  if (!Array.isArray(list) || list.length === 0) return 'существенных расхождений (>= 1 балла) не найдено';
  return list
    .map((d) => `- ${d.competency} → ${d.indicator}: самооценка ${d.self}, руководитель ${d.manager} (${d.higher} выше)`)
    .join('\n');
}

function buildPairCommentUserPrompt({ evalueeName, managerName, competencies, discrepancies }) {
  return `Подготовь материал к интервью руководителя с сотрудником по итогам сравнения самооценки и оценки руководителя.

Сотрудник: ${evalueeName}
Руководитель: ${managerName}

Средние баллы по компетенциям (самооценка / оценка руководителя, шкала 1–4):
${formatPairCompetencies(competencies)}

Расхождения по отдельным индикаторам (разница >= 1 балла):
${formatDiscrepancies(discrepancies)}

Верни ответ СТРОГО в виде JSON-объекта (без markdown, без обрамления \`\`\`json, без какого-либо текста до или после JSON) со следующей структурой:
{
  "summary": "3–5 предложений: кратко, где самооценка и оценка руководителя сходятся, а где расходятся и в чём это может быть выражено",
  "questions": ["открытый дружелюбный вопрос 1, привязанный к конкретному расхождению из данных выше", "вопрос 2", "..."]
}

В "questions" — от 4 до 6 конкретных открытых вопросов. Каждый вопрос должен быть привязан к реальному расхождению из списка выше (например, если по компетенции сотрудник оценил себя заметно выше руководителя — попроси привести пример, как он проявлял эту компетенцию за последние полгода). Если расхождений нет, задай общие открытые вопросы про сильные компетенции из списка. Вопросы должны помогать прояснить расхождения и прийти к общему пониманию — без обвинительного тона. Пиши по-русски, кратко и по-деловому. Опирайся только на переданные данные, ничего не выдумывай.`;
}

async function handleGeneratePairComment(req, res, body) {
  const { evalueeName, managerName, competencies, discrepancies } = body;

  if (!evalueeName || !managerName || !Array.isArray(competencies) || competencies.length === 0) {
    res.status(400).json({ error: 'Недостаточно данных для генерации комментария' });
    return;
  }

  try {
    const userPrompt = buildPairCommentUserPrompt({ evalueeName, managerName, competencies, discrepancies });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1200,
        system: PAIR_COMMENT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[generate-pair-comment] Anthropic API error:', response.status, errText);
      res.status(500).json({ error: 'Не удалось сгенерировать комментарий. Попробуйте ещё раз.' });
      return;
    }

    const data = await response.json();

    if (data?.error) {
      console.error('[generate-pair-comment] Anthropic error:', JSON.stringify(data.error));
      res.status(500).json({ error: 'Не удалось сгенерировать комментарий. Попробуйте ещё раз.' });
      return;
    }

    const text = extractText(data);

    if (!text) {
      console.error('[generate-pair-comment] Empty text. Full data:', JSON.stringify(data));
      res.status(500).json({ error: 'Не удалось сгенерировать комментарий. Попробуйте ещё раз.' });
      return;
    }

    const comment = parsePairCommentResponse(text);

    res.status(200).json({ comment });
  } catch (err) {
    console.error('[generate-pair-comment] Unexpected error:', err);
    res.status(500).json({ error: 'Не удалось сгенерировать комментарий. Попробуйте ещё раз.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// action=generate-idp (было api/generate-talent-idp.mjs, Фаза 5b) — POST
// ─────────────────────────────────────────────────────────────────────────
const IDP_SYSTEM_PROMPT = "Ты — опытный HR-эксперт по развитию персонала. По результатам оценки компетенций составляешь индивидуальный план развития: конкретный, практичный, поддерживающий. Опирайся только на переданные данные, ничего не выдумывай. Пиши по-русски, уважительно. НЕ используй ярлыки и категории карты талантов («проблема», «аутсайдер», «резерв», «квадрат» и т.п.) — только в терминах сильных сторон и зон развития. Фокусируйся на 1–3 приоритетных зонах роста, а не на всех сразу. Отвечай СТРОГО валидным JSON-объектом: без markdown-разметки, без обрамления ```json, без какого-либо текста до или после JSON.";

function parseIdpResponse(text) {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.plan)) {
      return parsed;
    }
  } catch (err) {
    // not valid JSON — fall through to the raw-text fallback below
  }

  return text;
}

function formatIdpCompetencies(list) {
  if (!Array.isArray(list) || list.length === 0) return 'нет данных';
  return list
    .map((c) => `- ${c.name}: балл ${c.score}${c.target ? ` (цель грейда ${c.target})` : ''}`)
    .join('\n');
}

function formatNames(list) {
  if (!Array.isArray(list) || list.length === 0) return 'нет данных';
  return list.join(', ');
}

function buildIdpUserPrompt({ employeeName, grade, targetScore, competencies, weakest, strongest }) {
  return `Составь индивидуальный план развития для сотрудника по результатам оценки компетенций (карта талантов, шкала 1–4).

Сотрудник: ${employeeName}
Грейд: ${grade || 'не указан'}
Целевой балл грейда: ${targetScore ?? 'не задан'}

Баллы по компетенциям:
${formatIdpCompetencies(competencies)}

Самые слабые компетенции (наибольший разрыв ниже цели грейда): ${formatNames(weakest)}
Самые сильные компетенции: ${formatNames(strongest)}

Верни ответ СТРОГО в виде JSON-объекта (без markdown, без обрамления \`\`\`json, без какого-либо текста до или после JSON) со следующей структурой:
{
  "strengths": "2–3 предложения о сильных сторонах, на что опираться",
  "growthAreas": ["зона роста 1", "зона роста 2"],
  "plan": [
    { "competency": "название компетенции", "action": "что конкретно делать", "result": "ожидаемый результат", "timeline": "срок, например 3-6 месяцев" }
  ]
}

В "plan" — от 3 до 5 пунктов, сфокусированных на 1–3 приоритетных зонах роста (самых слабых компетенциях), не на всех 7 сразу. Каждый пункт привязан к конкретной компетенции из данных. НЕ используй ярлыки и категории карты талантов («проблема», «аутсайдер», «резерв», «квадрат» и т.п.) — пиши в терминах сильных сторон и зон развития. Пиши по-русски, конкретно и уважительно.`;
}

async function handleGenerateIdp(req, res, body) {
  const { employeeName, grade, targetScore, competencies, weakest, strongest } = body;

  if (!employeeName || !Array.isArray(competencies) || competencies.length === 0) {
    res.status(400).json({ error: 'Недостаточно данных для генерации плана развития' });
    return;
  }

  try {
    const userPrompt = buildIdpUserPrompt({ employeeName, grade, targetScore, competencies, weakest, strongest });

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2000,
        system: IDP_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[generate-talent-idp] Anthropic API error:', response.status, errText);
      res.status(500).json({ error: 'Не удалось сгенерировать план развития. Попробуйте ещё раз.' });
      return;
    }

    const data = await response.json();

    if (data?.error) {
      console.error('[generate-talent-idp] Anthropic error:', JSON.stringify(data.error));
      res.status(500).json({ error: 'Не удалось сгенерировать план развития. Попробуйте ещё раз.' });
      return;
    }

    const text = extractText(data);

    if (!text) {
      console.error('[generate-talent-idp] Empty text. Full data:', JSON.stringify(data));
      res.status(500).json({ error: 'Не удалось сгенерировать план развития. Попробуйте ещё раз.' });
      return;
    }

    const idp = parseIdpResponse(text);

    res.status(200).json({ idp });
  } catch (err) {
    console.error('[generate-talent-idp] Unexpected error:', err);
    res.status(500).json({ error: 'Не удалось сгенерировать план развития. Попробуйте ещё раз.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// action=map-owner-uid — POST. Resolves the single shared talentMaps
// document id for an authenticated, allowed caller. Unlike the AI actions
// above (stateless proxies to Anthropic, no auth needed — same pattern as
// api/generate-ipr.mjs), this one identifies the caller, so it verifies
// idToken and checks their email against TALENT_MAP_ALLOWED_EMAILS before
// returning anything.
// ─────────────────────────────────────────────────────────────────────────
async function handleMapOwnerUid(req, res, body) {
  const { idToken } = body;
  if (!idToken) {
    res.status(400).json({ error: 'Не передан idToken' });
    return;
  }

  let adminAuth;
  try {
    adminAuth = getAdminAuth();
  } catch (err) {
    console.error('[talent:map-owner-uid] Admin SDK init failed:', err.message);
    res.status(500).json({ error: 'Сервис временно недоступен. Попробуйте позже.' });
    return;
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch (err) {
    console.error('[talent:map-owner-uid] idToken verification failed:', err.message);
    res.status(401).json({ error: 'Не удалось подтвердить личность. Войдите заново.' });
    return;
  }

  if (!TALENT_MAP_ALLOWED_EMAILS.includes(decoded.email)) {
    res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    return;
  }

  try {
    const ownerUid = await getSuperadminUid();
    res.status(200).json({ ownerUid });
  } catch (err) {
    console.error('[talent:map-owner-uid] Failed to resolve owner uid:', err.message);
    res.status(500).json({ error: 'Не удалось определить карту талантов.' });
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { action } = req.query;
    if (action === 'tasks') {
      await handleTasks(req, res);
      return;
    }
    if (action === 'task-form') {
      await handleTaskForm(req, res);
      return;
    }
    res.status(400).json({ error: 'Неизвестное действие' });
    return;
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch (err) {
      res.status(400).json({ error: 'Некорректное тело запроса' });
      return;
    }

    const { action } = body;
    if (action === 'save-task') {
      await handleSaveTask(req, res, body);
      return;
    }
    if (action === 'generate-pair-comment') {
      await handleGeneratePairComment(req, res, body);
      return;
    }
    if (action === 'generate-idp') {
      await handleGenerateIdp(req, res, body);
      return;
    }
    if (action === 'map-owner-uid') {
      await handleMapOwnerUid(req, res, body);
      return;
    }
    res.status(400).json({ error: 'Неизвестное действие' });
    return;
  }

  res.status(405).json({ error: 'Метод не поддерживается' });
}
