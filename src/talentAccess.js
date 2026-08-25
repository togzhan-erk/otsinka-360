// Карта талантов — список email, которым разрешён доступ к модулю. Это
// НЕ то же самое, что src/auth.js's SUPERADMIN_EMAIL/isSuperadmin: доступ к
// «Клиенты» и права по управлению клиентами (создание/удаление аккаунтов
// HR-клиентов) остаются строго за одним email — SUPERADMIN_EMAIL. Карта
// талантов — отдельный, более широкий общий внутренний инструмент, поэтому
// у неё свой список.
//
// Файл намеренно не импортирует ничего из firebase/* — он импортируется и
// клиентским кодом (AdminDashboard.jsx, TalentMapTab.jsx), и серверными
// функциями (api/talent.mjs, тем же способом, что и src/talentCompetencies.js
// уже импортируется оттуда), поэтому должен быть чистым.
export const TALENT_MAP_ALLOWED_EMAILS = [
  'elctogzhan@gmail.com',
  'maksim_a@eng-services.kz',
];

export function isTalentMapAllowed(user) {
  return !!user && TALENT_MAP_ALLOWED_EMAILS.includes(user.email);
}
