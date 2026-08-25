// Карта талантов (Фаза 3) — AI-комментарий к паре «оцениваемый + его
// руководитель»: где самооценка и оценка руководителя сходятся, где
// расходятся, на что обратить внимание на интервью. Тот же паттерн, что
// api/generate-ipr.mjs — ESM, ключ из process.env.ANTHROPIC_API_KEY,
// claude-sonnet-5, устойчивый разбор ответа с fallback на сырой текст.

const SYSTEM_PROMPT = "Ты — опытный HR-эксперт, который готовит руководителя к диалогу с сотрудником по итогам оценки «Карта талантов» (сравнение самооценки сотрудника и оценки его руководителя по компетенциям, шкала 1–4). Опирайся СТРОГО на переданные баллы и расхождения — ничего не выдумывай и не додумывай, не упоминай данные, которых нет во входных данных. Пиши по-русски, кратко и по-деловому, без канцелярита и общих фраз. Отвечай СТРОГО валидным JSON-объектом: без markdown-разметки, без обрамления ```json, без какого-либо текста до или после JSON.";

function extractText(data) {
  if (!Array.isArray(data?.content)) return '';
  return data.content
    .filter((item) => typeof item?.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function parsePairCommentResponse(text) {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' &&
      (typeof parsed.agreements === 'string' || typeof parsed.disagreements === 'string' || typeof parsed.interviewFocus === 'string')) {
      return parsed;
    }
  } catch (err) {
    // not valid JSON — fall through to the raw-text fallback below
  }

  return text;
}

function formatCompetencies(list) {
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

function buildUserPrompt({ evalueeName, managerName, competencies, discrepancies }) {
  return `Подготовь краткий комментарий к паре оценок для интервью руководителя с сотрудником.

Сотрудник: ${evalueeName}
Руководитель: ${managerName}

Средние баллы по компетенциям (самооценка / оценка руководителя, шкала 1–4):
${formatCompetencies(competencies)}

Расхождения по отдельным индикаторам (разница >= 1 балла):
${formatDiscrepancies(discrepancies)}

Верни ответ СТРОГО в виде JSON-объекта (без markdown, без обрамления \`\`\`json, без какого-либо текста до или после JSON) со следующей структурой:
{
  "agreements": "2–4 предложения о том, где самооценка и оценка руководителя сходятся",
  "disagreements": "2–4 предложения о том, где они расходятся и в чём это может быть выражено",
  "interviewFocus": "2–4 предложения о том, на что обратить внимание на предстоящем интервью руководитель–сотрудник"
}

Пиши по-русски, кратко и по-деловому. Опирайся только на переданные данные.`;
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

  const { evalueeName, managerName, competencies, discrepancies } = body;

  if (!evalueeName || !managerName || !Array.isArray(competencies) || competencies.length === 0) {
    res.status(400).json({ error: 'Недостаточно данных для генерации комментария' });
    return;
  }

  try {
    const userPrompt = buildUserPrompt({ evalueeName, managerName, competencies, discrepancies });

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
        system: SYSTEM_PROMPT,
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
