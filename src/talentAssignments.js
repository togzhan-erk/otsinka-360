// Карта талантов — автоматическое распределение задач оценки.
// Правила: каждый сотрудник оценивает себя; каждый руководитель оценивает
// каждого своего прямого подчинённого (связь определяется по колонке
// «Email руководителя»). Никаких других типов оценивающих в этой фазе.

export const TALENT_ASSIGNMENT_SELF = 'self';
export const TALENT_ASSIGNMENT_MANAGER = 'manager';

// Чистая функция от списка сотрудников — id каждой задачи строится из
// id участников, а не из времени/случайности, поэтому повторный вызов при
// неизменных сотрудниках всегда даёт тот же набор id: пересчёт и
// сохранение результата никогда не создают дублей.
export function computeTalentAssignments(employees) {
  const norm = (email) => (email || '').trim().toLowerCase();
  const byEmail = new Map(employees.filter(e => e.email).map(e => [norm(e.email), e]));

  const assignments = [];
  employees.forEach(emp => {
    assignments.push({
      id: `self_${emp.id}`,
      raterId: emp.id,
      evalueeId: emp.id,
      type: TALENT_ASSIGNMENT_SELF,
      status: 'not_started',
    });

    const managerEmail = norm(emp.managerEmail);
    const manager = managerEmail ? byEmail.get(managerEmail) : null;
    if (manager && manager.id !== emp.id) {
      assignments.push({
        id: `manager_${manager.id}_${emp.id}`,
        raterId: manager.id,
        evalueeId: emp.id,
        type: TALENT_ASSIGNMENT_MANAGER,
        status: 'not_started',
      });
    }
  });
  return assignments;
}

// Фаза 2: задачи оценки теперь несут статус (не начата/в процессе/
// завершена), обновляемый серверными функциями (api/talent-task-save.mjs) по
// мере заполнения формы. computeTalentAssignments выше — чистый пересчёт
// структуры «кто кого оценивает» из текущего списка сотрудников и сам по
// себе не знает о прогрессе; эта функция накладывает пересчитанную
// структуру на уже сохранённые задачи, перенося status/updatedAt/
// completedAt для каждой пары, что не изменилась (сматчено по id), и ставя
// status='not_started' только для новых пар. Так «Сохранить распределение»
// можно нажимать повторно (например, после правки грейда) не теряя прогресс
// уже начатых оценок.
export function computeMergedTalentAssignments(employees, previousAssignments = []) {
  const fresh = computeTalentAssignments(employees);
  const prevById = new Map((previousAssignments || []).map(a => [a.id, a]));
  return fresh.map(a => {
    const prev = prevById.get(a.id);
    if (!prev) return a;
    return {
      ...a,
      status: prev.status || 'not_started',
      updatedAt: prev.updatedAt ?? null,
      completedAt: prev.completedAt ?? null,
    };
  });
}
