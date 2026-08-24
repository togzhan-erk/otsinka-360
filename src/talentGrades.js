// Карта талантов — грейды и целевые баллы. Не связано с треками 360
// (src/competencies.js) — своя, отдельная шкала.

export const DEFAULT_GRADE_TARGETS = [
  { grade: 'СЕО-1', target: 3.93 },
  { grade: 'СЕО-2', target: 3.00 },
  { grade: 'СЕО-3', target: 2.00 },
  { grade: 'СЕО-4', target: 2.00 },
  { grade: 'СЕО-5', target: 2.00 },
];

// Depth 0 (нет руководителя) → СЕО-1, depth 1 → СЕО-2, и так далее — только
// подсказка для незаполненных грейдов, не привязана к таблице целевых
// баллов (если иерархия глубже пяти уровней, СЕО-6 и далее просто не будут
// иметь целевого балла, пока суперадмин не добавит строку в таблицу).
export function suggestGradeByDepth(depth) {
  return `СЕО-${depth + 1}`;
}

// Присваивает каждому сотруднику глубину в иерархии, используя только связи
// email → email руководителя. Сотрудник без руководителя (пусто) или чей
// managerEmail не совпадает ни с одним email в списке — корень (depth 0).
// Строится обходом в ширину от корней, поэтому даже кольцевые ссылки в
// плохих данных (A — руководитель B, B — руководитель A) не приводят к
// бесконечному циклу: недостижимые от корня сотрудники просто получают
// depth 0 по умолчанию.
export function computeHierarchyDepths(employees) {
  const norm = (email) => (email || '').trim().toLowerCase();
  const byEmail = new Map(employees.filter(e => e.email).map(e => [norm(e.email), e]));

  const childrenOf = new Map(employees.map(e => [e.id, []]));
  const roots = [];

  employees.forEach(emp => {
    const managerEmail = norm(emp.managerEmail);
    const manager = managerEmail ? byEmail.get(managerEmail) : null;
    if (manager && manager.id !== emp.id) {
      childrenOf.get(manager.id).push(emp.id);
    } else {
      roots.push(emp.id);
    }
  });

  const depths = new Map();
  const queue = roots.map(id => [id, 0]);
  while (queue.length > 0) {
    const [id, depth] = queue.shift();
    if (depths.has(id)) continue;
    depths.set(id, depth);
    (childrenOf.get(id) || []).forEach(childId => queue.push([childId, depth + 1]));
  }

  employees.forEach(emp => {
    if (!depths.has(emp.id)) depths.set(emp.id, 0);
  });

  return depths;
}
