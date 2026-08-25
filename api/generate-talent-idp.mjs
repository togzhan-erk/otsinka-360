// Карта талантов (Фаза 5b) — индивидуальный план развития (IDP) по
// финальным (согласованным на интервью) баллам сотрудника. Тот же паттерн,
// что api/generate-ipr.mjs и api/generate-pair-comment.mjs — ESM, ключ из
// process.env.ANTHROPIC_API_KEY, claude-sonnet-5, устойчивый разбор
// ответа с fallback на сырой текст. Формат JSON намеренно такой же, как у
// ИПР 360 (strengths/growthAreas/plan), чтобы клиент мог использовать ту
// же табличную раскладку — но это отдельная, независимая функция: сюда
// никогда не передаются данные 360-опросов, только карта талантов.
//
// SYSTEM_PROMPT явно запрещает ярлыки карты талантов (квадрант/пул/
// «проблема» и т.п.) — план развития может показываться самому сотруднику,
// а категоризация 9-box конфиденциальна для HR/комитета (см. также
// PDF-экспорт в TalentMapIdpDetail.jsx, который не включает эти ярлыки).
const SYSTEM_PROMPT = "Ты — опытный HR-эксперт по развитию персонала. По результатам оценки компетенций составляешь индивидуальный план развития: конкретный, практичный, поддерживающий. Опирайся только на переданные данные, ничего не выдумывай. Пиши по-русски, уважительно. НЕ используй ярлыки и категории карты талантов («проблема», «аутсайдер», «резерв», «квадрат» и т.п.) — только в терминах сильных сторон и зон развития. Фокусируйся на 1–3 приоритетных зонах роста, а не на всех сразу. Отвечай СТРОГО валидным JSON-объектом: без markdown-разметки, без обрамления ```json, без какого-либо текста до или после JSON.";

function extractText(data) {
  if (!Array.isArray(data?.content)) return '';
  return data.content
    .filter((item) => typeof item?.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

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

function formatCompetencies(list) {
  if (!Array.isArray(list) || list.length === 0) return 'нет данных';
  return list
    .map((c) => `- ${c.name}: балл ${c.score}${c.target ? ` (цель грейда ${c.target})` : ''}`)
    .join('\n');
}

function formatNames(list) {
  if (!Array.isArray(list) || list.length === 0) return 'нет данных';
  return list.join(', ');
}

function buildUserPrompt({ employeeName, grade, targetScore, competencies, weakest, strongest }) {
  return `Составь индивидуальный план развития для сотрудника по результатам оценки компетенций (карта талантов, шкала 1–4).

Сотрудник: ${employeeName}
Грейд: ${grade || 'не указан'}
Целевой балл грейда: ${targetScore ?? 'не задан'}

Баллы по компетенциям:
${formatCompetencies(competencies)}

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

  const { employeeName, grade, targetScore, competencies, weakest, strongest } = body;

  if (!employeeName || !Array.isArray(competencies) || competencies.length === 0) {
    res.status(400).json({ error: 'Недостаточно данных для генерации плана развития' });
    return;
  }

  try {
    const userPrompt = buildUserPrompt({ employeeName, grade, targetScore, competencies, weakest, strongest });

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
