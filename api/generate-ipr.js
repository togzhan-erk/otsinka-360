const SYSTEM_PROMPT = "Ты — опытный HR-эксперт по развитию персонала. На основе результатов оценки 360° ты составляешь индивидуальный план развития (ИПР) сотрудника: конкретный, практичный и поддерживающий. Опирайся только на предоставленные данные, ничего не выдумывай. Не указывай, кто именно дал ту или иную оценку или комментарий — сохраняй анонимность оценивающих. Пиши по-русски, профессионально и уважительно, без канцелярита и общих фраз. Отвечай СТРОГО валидным JSON-объектом: без markdown-разметки, без обрамления ```json, без какого-либо текста до или после JSON.";

// Anthropic's content blocks are usually a single { type: "text", text }
// item, but can legitimately contain other block types or multiple text
// blocks (and a response cut off by max_tokens is still valid, partial
// text) — concatenate every block that has a string .text instead of
// assuming content[0].
function extractText(data) {
  if (!Array.isArray(data?.content)) return '';
  return data.content
    .filter((item) => typeof item?.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

// The model is asked for raw JSON but may still wrap it in a ```json fence
// out of habit — strip that defensively before parsing. Falls back to the
// raw string if parsing fails or the shape doesn't look like a plan, so the
// client always has something to show.
function parseIprResponse(text) {
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

function formatCompetencies(list) {
  if (!Array.isArray(list) || list.length === 0) return 'нет данных';
  return list
    .map((c) => {
      if (c.self !== undefined && c.self !== null) {
        return `- ${c.name}: самооценка ${c.self} / команда ${c.team}`;
      }
      return `- ${c.name}: команда ${c.team}`;
    })
    .join('\n');
}

function formatComments(list) {
  if (!Array.isArray(list) || list.length === 0) return 'нет комментариев';
  return list.map((text) => `- ${text}`).join('\n');
}

function buildUserPrompt({ employeeName, track, averageScore, competencies, strengthsComments, growthComments }) {
  return `Составь индивидуальный план развития для сотрудника по результатам оценки 360°.

Данные:
Сотрудник: ${employeeName}
Трек: ${track}
Средний балл: ${averageScore} из 5

Оценки по компетенциям (из 5):
${formatCompetencies(competencies)}

Что сотрудник делает особенно хорошо (анонимные комментарии):
${formatComments(strengthsComments)}

Что сотруднику стоит развить (анонимные комментарии):
${formatComments(growthComments)}

Верни ответ СТРОГО в виде JSON-объекта (без markdown, без обрамления \`\`\`json, без какого-либо текста до или после JSON) со следующей структурой:
{
  "strengths": "2–3 предложения о сильных сторонах, на что опираться (компетенции с высокими оценками команды)",
  "growthAreas": ["зона роста 1", "зона роста 2"],
  "plan": [
    { "competency": "название компетенции", "action": "что конкретно делать, включая как именно", "result": "ожидаемый результат", "timeline": "срок, например 3 месяца" }
  ]
}

В "plan" должно быть от 3 до 5 пунктов, каждый привязан к конкретной компетенции из данных. Действия должны быть выполнимы за 3–6 месяцев. Не указывай, кто именно дал ту или иную оценку или комментарий — сохраняй анонимность оценивающих. Пиши по-русски, конкретно и поддерживающе.`;
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

  const { employeeName, track, averageScore, competencies, strengthsComments, growthComments } = body;

  if (!employeeName || !Array.isArray(competencies) || competencies.length === 0) {
    res.status(400).json({ error: 'Недостаточно данных для генерации ИПР' });
    return;
  }

  try {
    const userPrompt = buildUserPrompt({ employeeName, track, averageScore, competencies, strengthsComments, growthComments });

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
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error('[generate-ipr] Anthropic API error:', response.status, errText);
      res.status(500).json({ error: 'Не удалось сгенерировать ИПР. Попробуйте ещё раз.' });
      return;
    }

    const data = await response.json();

    if (data?.error) {
      console.error('Anthropic error:', JSON.stringify(data.error));
      res.status(500).json({ error: 'Не удалось сгенерировать ИПР. Попробуйте ещё раз.' });
      return;
    }

    // stop_reason "max_tokens" means the response was cut off, not that it
    // failed — whatever text came through is still returned to the client.
    const text = extractText(data);

    if (!text) {
      console.error('[generate-ipr] Empty text. Full data:', JSON.stringify(data));
      res.status(500).json({ error: 'Не удалось сгенерировать ИПР. Попробуйте ещё раз.' });
      return;
    }

    const ipr = parseIprResponse(text);

    res.status(200).json({ ipr });
  } catch (err) {
    console.error('[generate-ipr] Unexpected error:', err);
    res.status(500).json({ error: 'Не удалось сгенерировать ИПР. Попробуйте ещё раз.' });
  }
}
