// Карта талантов — слой доступа к Firestore. Полностью отдельная
// коллекция (talentMaps), не пересекается ни с одним путём, который
// использует модуль опросов 360 (src/cycles.js: cycles/{cycleId}/...).
//
// Один документ на владельца: talentMaps/{ownerUid}. Модуль доступен
// только суперадмину (проверяется на уровне UI — src/auth.js:
// isSuperadmin), поэтому одного документа на аккаунт достаточно для
// Фазы 1/2/3; данные хранятся полями на этом документе (employees,
// gradeTargets, assignments, pairComments), как и cycles/{cycleId} хранит
// employees и roleAssignments — тот же паттерн, другая коллекция. Чтение —
// через живую подписку onSnapshot прямо в TalentMapTab.jsx (тот же приём,
// что AdminDashboard.jsx уже использует для cycles/{cycleId}), так что этот
// модуль отвечает только за запись плюс разовые чтения ответов оценки
// (responses/{taskId} — отдельные документы, каждый пишется сервером через
// api/talent-task-save.mjs, читаются здесь только суперадмином для отчёта
// по паре).

import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

function talentMapRef(ownerUid) {
  return doc(db, 'talentMaps', ownerUid);
}

// Частичное обновление (merge: true) — можно сохранять только employees,
// только gradeTargets или только assignments, не перезаписывая остальное.
export async function saveTalentMapData(ownerUid, data) {
  if (!ownerUid) throw new Error('ownerUid обязателен для сохранения карты талантов');
  await setDoc(talentMapRef(ownerUid), { ...data, ownerUid, updatedAt: serverTimestamp() }, { merge: true });
}

// Один ответ на одну задачу оценки (self_<id> или manager_<managerId>_<id>)
// — те же документы, что пишет api/talent-task-save.mjs. Разрешено правилом
// talentMaps/{ownerUid}/responses/{taskId} (read: суперадмин-владелец,
// write: false — пишет только Admin SDK).
export async function getTalentResponse(ownerUid, taskId) {
  if (!ownerUid || !taskId) return null;
  const snap = await getDoc(doc(db, 'talentMaps', ownerUid, 'responses', String(taskId)));
  return snap.exists() ? snap.data() : null;
}

// AI-комментарий к паре хранится как одна запись в объекте pairComments на
// главном документе (pairComments.<evalueeId>), а не отдельным документом —
// он маленький и его удобно грузить вместе с остальными данными карты через
// уже существующую живую подписку в TalentMapTab.jsx. updateDoc с
// точечным путём ключа гарантированно трогает только этот один evalueeId,
// не задевая комментарии остальных пар.
//
// api/generate-pair-comment.mjs возвращает либо структурированный объект
// {agreements, disagreements, interviewFocus} (обычный случай), либо, если
// модель не вернула валидный JSON, сырую строку — тот же fallback, что
// api/generate-ipr.mjs уже использует для ИПР. Firestore не может хранить
// строку под ключом карты как есть (а spread `...comment` по строке дал бы
// объект с числовыми индексами вместо текста), поэтому строка оборачивается
// в { text }, а объект сохраняется как есть.
export async function savePairComment(ownerUid, evalueeId, comment) {
  if (!ownerUid || !evalueeId) throw new Error('ownerUid и evalueeId обязательны');
  const payload = typeof comment === 'string' ? { text: comment } : { ...comment };
  await updateDoc(talentMapRef(ownerUid), {
    [`pairComments.${evalueeId}`]: { ...payload, generatedAt: serverTimestamp() },
  });
}

// Финальные (согласованные на интервью руководитель–сотрудник) баллы и
// рассчитанный по ним индекс соответствия (src/talentCompliance.js —
// расчёт полностью детерминированный, эта функция только сохраняет уже
// готовый результат). Тот же приём точечного ключа, что у pairComments —
// finalAssessments.<evalueeId> обновляется, не трогая записи других
// сотрудников. Расчёт хранится вместе со снимком грейда/целевого балла, на
// момент которых он был сделан, чтобы Фаза 5 (карта 9-box) могла просто
// прочитать effectiveBand, не пересчитывая ничего заново.
export async function saveFinalAssessment(ownerUid, evalueeId, assessment) {
  if (!ownerUid || !evalueeId) throw new Error('ownerUid и evalueeId обязательны');
  await updateDoc(talentMapRef(ownerUid), {
    [`finalAssessments.${evalueeId}`]: { ...assessment, updatedAt: serverTimestamp() },
  });
}

// Ось Y (KPI, Фаза 5a) — та же точечная запись по evalueeId, что у
// finalAssessments/pairComments. Хранит и вручную выбранную полосу
// (manualBand), и необязательный KPI% — src/talentNineBox.js:
// computeEffectiveYBand() решает на чтении, каким из двух пользоваться.
export async function saveYAxisAssessment(ownerUid, evalueeId, data) {
  if (!ownerUid || !evalueeId) throw new Error('ownerUid и evalueeId обязательны');
  await updateDoc(talentMapRef(ownerUid), {
    [`yAxisAssessments.${evalueeId}`]: { ...data, updatedAt: serverTimestamp() },
  });
}

// Ручное добавление/исключение сотрудника из автосписка пула
// (TalentMapTalentPools.jsx) — { added: [employeeId, ...], removed: [...] }
// на один из 4 пулов (POOL_RESERVE1/RESERVE2/WATCHLIST/REDZONE из
// src/talentNineBox.js). Автосписок сам по себе нигде не хранится —
// пересчитывается из quadrants + текущего размещения при каждом рендере,
// здесь сохраняется только ручная поправка поверх него.
export async function saveTalentPoolOverride(ownerUid, poolKey, override) {
  if (!ownerUid || !poolKey) throw new Error('ownerUid и poolKey обязательны');
  await updateDoc(talentMapRef(ownerUid), {
    [`talentPoolOverrides.${poolKey}`]: override,
  });
}

// AI-план развития (IDP, Фаза 5b) по финальным баллам сотрудника — та же
// точечная запись по evalueeId, тот же приём {text} для сырого фолбэка,
// что и у savePairComment (api/generate-talent-idp.mjs возвращает либо
// структурированный {strengths, growthAreas, plan}, либо сырую строку).
export async function saveIdpPlan(ownerUid, evalueeId, plan) {
  if (!ownerUid || !evalueeId) throw new Error('ownerUid и evalueeId обязательны');
  const payload = typeof plan === 'string' ? { text: plan } : { ...plan };
  await updateDoc(talentMapRef(ownerUid), {
    [`idpPlans.${evalueeId}`]: { ...payload, generatedAt: serverTimestamp() },
  });
}
