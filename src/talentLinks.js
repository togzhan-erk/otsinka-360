// Карта талантов — построение персональной ссылки сотрудника из его токена.
// Тот же хост, что и у ссылок 360 (см. BASE_URL в AdminDashboard.jsx), но
// свой query-параметр (talentToken), который App.js обрабатывает отдельной
// веткой, независимой от инвайтов 360.
const TALENT_BASE_URL = 'https://otsinka-360.vercel.app';

export function buildTalentLink(token) {
  return `${TALENT_BASE_URL}/?talentToken=${token}`;
}
