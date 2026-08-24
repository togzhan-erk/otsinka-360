// Карта талантов — персональные токены сотрудников (Фаза 2). Токен —
// единственный ключ доступа к личной ссылке со списком задач оценки
// (api/talent-tasks.mjs ищет сотрудника по нему), поэтому он должен быть
// непредсказуемым и стабильным: сгенерированный однажды токен не меняется
// при последующих сохранениях того же сотрудника (см. ensureEmployeeTokens).

export function generateTalentToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += Math.floor(Math.random() * 16).toString(16);
  }
  return token;
}

// Гарантирует, что у каждого сотрудника есть токен, не трогая уже
// существующие (иначе выданные ранее ссылки перестали бы работать).
export function ensureEmployeeTokens(employees) {
  let changed = false;
  const next = employees.map(emp => {
    if (emp.token) return emp;
    changed = true;
    return { ...emp, token: generateTalentToken() };
  });
  return { employees: next, changed };
}
