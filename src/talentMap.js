// Карта талантов — слой доступа к Firestore. Полностью отдельная
// коллекция (talentMaps), не пересекается ни с одним путём, который
// использует модуль опросов 360 (src/cycles.js: cycles/{cycleId}/...).
//
// ОДИН документ на фиксированном адресе talentMaps/main — общий инвентарь
// компании, не привязанный к чьему-либо Firebase uid. Кто имеет доступ,
// определяется полем allowedEmails на самом документе плюс суперадмином
// (elctogzhan@gmail.com, у него доступ всегда, безусловно) — это
// проверяется в firestore.rules и, для тех же двух AI-функций, в
// api/talent.mjs. Список редактируется прямо из интерфейса
// (TalentMapAccessPanel.jsx), без правки кода.
//
// Данные хранятся полями на этом документе (employees, gradeTargets,
// assignments, pairComments, allowedEmails, ...), как и cycles/{cycleId}
// хранит employees и roleAssignments — тот же паттерн, другая коллекция.
// Чтение — через живую подписку onSnapshot прямо в TalentMapTab.jsx (тот
// же приём, что AdminDashboard.jsx уже использует для cycles/{cycleId}),
// так что этот модуль отвечает только за запись плюс разовые чтения
// ответов оценки (responses/{taskId} — отдельные документы, каждый
// пишется сервером через api/talent.mjs (action=save-task), читаются
// здесь только для отчёта по паре).

import {
  doc, getDoc, getDocs, collection, setDoc, updateDoc, serverTimestamp, writeBatch, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';

export const TALENT_MAP_DOC_ID = 'main';

function talentMapRef() {
  return doc(db, 'talentMaps', TALENT_MAP_DOC_ID);
}

// Частичное обновление (merge: true) — можно сохранять только employees,
// только gradeTargets, только allowedEmails и т.п., не перезаписывая
// остальное.
export async function saveTalentMapData(data) {
  await setDoc(talentMapRef(), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

// Один ответ на одну задачу оценки (self_<id> или manager_<managerId>_<id>)
// — те же документы, что пишет api/talent.mjs (action=save-task).
// Разрешено правилом talentMaps/main/responses/{taskId} (read:
// суперадмин или email из allowedEmails; write: false — пишет только
// Admin SDK).
export async function getTalentResponse(taskId) {
  if (!taskId) return null;
  const snap = await getDoc(doc(db, 'talentMaps', TALENT_MAP_DOC_ID, 'responses', String(taskId)));
  return snap.exists() ? snap.data() : null;
}

// AI-комментарий к паре хранится как одна запись в объекте pairComments на
// главном документе (pairComments.<evalueeId>), а не отдельным документом —
// он маленький и его удобно грузить вместе с остальными данными карты через
// уже существующую живую подписку в TalentMapTab.jsx. updateDoc с
// точечным путём ключа гарантированно трогает только этот один evalueeId,
// не задевая комментарии остальных пар.
//
// api/talent.mjs (action=generate-pair-comment) возвращает либо
// структурированный объект {summary, questions} (обычный случай), либо,
// если модель не вернула валидный JSON, сырую строку — тот же fallback,
// что action=generate-idp использует для плана развития. Firestore не
// может хранить строку под ключом карты как есть (а spread `...comment`
// по строке дал бы объект с числовыми индексами вместо текста), поэтому
// строка оборачивается в { text }, а объект сохраняется как есть.
export async function savePairComment(evalueeId, comment) {
  if (!evalueeId) throw new Error('evalueeId обязателен');
  const payload = typeof comment === 'string' ? { text: comment } : { ...comment };
  await updateDoc(talentMapRef(), {
    [`pairComments.${evalueeId}`]: { ...payload, generatedAt: serverTimestamp() },
  });
}

// Финальные (согласованные на интервью руководитель–сотрудник) баллы и
// рассчитанный по ним индекс соответствия (src/talentCompliance.js —
// расчёт полностью детерминированный, эта функция только сохраняет уже
// готовый результат). Тот же приём точечного ключа, что у pairComments —
// finalAssessments.<evalueeId> обновляется, не трогая записи других
// сотрудников.
export async function saveFinalAssessment(evalueeId, assessment) {
  if (!evalueeId) throw new Error('evalueeId обязателен');
  await updateDoc(talentMapRef(), {
    [`finalAssessments.${evalueeId}`]: { ...assessment, updatedAt: serverTimestamp() },
  });
}

// Ось Y (KPI, Фаза 5a) — та же точечная запись по evalueeId, что у
// finalAssessments/pairComments. Хранит и вручную выбранную полосу
// (manualBand), и необязательный KPI% — src/talentNineBox.js:
// computeEffectiveYBand() решает на чтении, каким из двух пользоваться.
export async function saveYAxisAssessment(evalueeId, data) {
  if (!evalueeId) throw new Error('evalueeId обязателен');
  await updateDoc(talentMapRef(), {
    [`yAxisAssessments.${evalueeId}`]: { ...data, updatedAt: serverTimestamp() },
  });
}

// Ручное добавление/исключение сотрудника из автосписка пула
// (TalentMapTalentPools.jsx) — { added: [employeeId, ...], removed: [...] }
// на один из 4 пулов (POOL_RESERVE1/RESERVE2/WATCHLIST/REDZONE из
// src/talentNineBox.js). Автосписок сам по себе нигде не хранится —
// пересчитывается из quadrants + текущего размещения при каждом рендере,
// здесь сохраняется только ручная поправка поверх него.
export async function saveTalentPoolOverride(poolKey, override) {
  if (!poolKey) throw new Error('poolKey обязателен');
  await updateDoc(talentMapRef(), {
    [`talentPoolOverrides.${poolKey}`]: override,
  });
}

// AI-план развития (IDP, Фаза 5b) по финальным баллам сотрудника — та же
// точечная запись по evalueeId, тот же приём {text} для сырого фолбэка,
// что и у savePairComment.
export async function saveIdpPlan(evalueeId, plan) {
  if (!evalueeId) throw new Error('evalueeId обязателен');
  const payload = typeof plan === 'string' ? { text: plan } : { ...plan };
  await updateDoc(talentMapRef(), {
    [`idpPlans.${evalueeId}`]: { ...payload, generatedAt: serverTimestamp() },
  });
}

// ── Одноразовая миграция: talentMaps/{uid суперадмина} → talentMaps/main ──
//
// До этой правки документ карты талантов жил на talentMaps/{ownerUid}, где
// ownerUid — собственный Firebase uid суперадмина (единственный, у кого
// был доступ). Теперь адрес фиксирован (talentMaps/main), чтобы к одному и
// тому же документу мог обращаться любой email из allowedEmails, а не
// только владелец исходного uid. oldOwnerUid — это СВОЙ uid вызывающего
// суперадмина (единственный uid, под которым легаси-документ вообще мог
// существовать), поэтому эта функция осмысленна только когда её вызывает
// сам суперадмин (проверяется в TalentMapTab.jsx перед вызовом).
//
// Guarded так же, как миграции 360 в src/cycles.js: транзакционная
// блокировка на meta/talentMapSharedDocMigration, безопасно вызывать при
// каждом входе суперадмина — реально что-то делает только один раз.
// Ничего не удаляет: легаси-документ и его responses остаются на месте,
// только копируются.
export async function migrateTalentMapToSharedDocIfNeeded(oldOwnerUid) {
  if (!oldOwnerUid || oldOwnerUid === TALENT_MAP_DOC_ID) return;

  const migrationRef = doc(db, 'meta', 'talentMapSharedDocMigration');
  let wonRace = false;
  try {
    await runTransaction(db, async (tx) => {
      const migSnap = await tx.get(migrationRef);
      if (migSnap.exists() && migSnap.data().done) return;
      tx.set(migrationRef, { done: true, migratedAt: serverTimestamp() });
      wonRace = true;
    });
  } catch (err) {
    console.error('[talentMap] Migration lock transaction failed:', err);
    return;
  }
  if (!wonRace) return;

  console.log('[talentMap] Running one-time migration to shared talentMaps/main...');
  try {
    const oldRef = doc(db, 'talentMaps', oldOwnerUid);
    const oldSnap = await getDoc(oldRef);
    if (!oldSnap.exists()) {
      console.log('[talentMap] No legacy talentMaps/{uid} document found — nothing to migrate.');
      return;
    }

    const newRef = talentMapRef();
    const newSnap = await getDoc(newRef);
    if (newSnap.exists()) {
      console.log('[talentMap] talentMaps/main already exists — skipping data copy (already migrated or created independently).');
      return;
    }

    const oldData = oldSnap.data();
    await setDoc(newRef, { ...oldData, allowedEmails: oldData.allowedEmails || [] });

    const responsesSnap = await getDocs(collection(db, 'talentMaps', oldOwnerUid, 'responses'));
    for (let i = 0; i < responsesSnap.docs.length; i += 400) {
      const batch = writeBatch(db);
      responsesSnap.docs.slice(i, i + 400).forEach((d) => {
        batch.set(doc(db, 'talentMaps', TALENT_MAP_DOC_ID, 'responses', d.id), d.data());
      });
      await batch.commit();
    }

    console.log('[talentMap] Migration complete. Copied', responsesSnap.docs.length, 'response document(s).');
  } catch (err) {
    console.error('[talentMap] Migration failed:', err);
  }
}
