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
    });

    const managerEmail = norm(emp.managerEmail);
    const manager = managerEmail ? byEmail.get(managerEmail) : null;
    if (manager && manager.id !== emp.id) {
      assignments.push({
        id: `manager_${manager.id}_${emp.id}`,
        raterId: manager.id,
        evalueeId: emp.id,
        type: TALENT_ASSIGNMENT_MANAGER,
      });
    }
  });
  return assignments;
}
