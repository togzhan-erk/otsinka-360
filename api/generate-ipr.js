const SYSTEM_PROMPT = "Ты — опытный HR-эксперт по развитию персонала. На основе результатов оценки 360° ты составляешь индивидуальный план развития (ИПР) сотрудника: конкретный, практичный и поддерживающий. Опирайся только на предоставленные данные, ничего не выдумывай. Не указывай, кто именно дал ту или иную оценку или комментарий — сохраняй анонимность оценивающих. Пиши по-русски, профессионально и уважительно, без канцелярита и общих фраз.";

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

Сформируй ответ строго в такой структуре, с этими тремя заголовками:

Сильные стороны
2–3 предложения о том, на что опираться (компетенции с высокими оценками команды).

Зоны роста
2–3 пункта на основе самых низких оценок команды и компетенций, где самооценка заметно выше оценки команды (возможные слепые зоны).

План развития
3–5 конкретных действий. Каждое действие — отдельным абзацем: что делать, как именно и какого результата ожидать. Привязывай действия к конкретным компетенциям из данных. Действия должны быть выполнимы за 3–6 месяцев.

Будь конкретным и поддерживающим. Не перечисляй сами баллы в тексте — интерпретируй их.`;
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
        max_tokens: 1200,
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
    const text = data?.content?.[0]?.text;

    if (!text) {
      console.error('[generate-ipr] Unexpected Anthropic response shape:', JSON.stringify(data));
      res.status(500).json({ error: 'Не удалось сгенерировать ИПР. Попробуйте ещё раз.' });
      return;
    }

    res.status(200).json({ ipr: text });
  } catch (err) {
    console.error('[generate-ipr] Unexpected error:', err);
    res.status(500).json({ error: 'Не удалось сгенерировать ИПР. Попробуйте ещё раз.' });
  }
}
