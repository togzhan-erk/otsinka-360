// Карта талантов — слой доступа к Firestore. Полностью отдельная
// коллекция (talentMaps), не пересекается ни с одним путём, который
// использует модуль опросов 360 (src/cycles.js: cycles/{cycleId}/...).
//
// Один документ на владельца: talentMaps/{ownerUid}. Модуль доступен
// только суперадмину (проверяется на уровне UI — src/auth.js:
// isSuperadmin), поэтому одного документа на аккаунт достаточно для
// Фазы 1; данные хранятся полями на этом документе (employees,
// gradeTargets, assignments), как и cycles/{cycleId} хранит employees и
// roleAssignments — тот же паттерн, другая коллекция.

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

function talentMapRef(ownerUid) {
  return doc(db, 'talentMaps', ownerUid);
}

export async function getTalentMap(ownerUid) {
  if (!ownerUid) return null;
  const snap = await getDoc(talentMapRef(ownerUid));
  return snap.exists() ? snap.data() : null;
}

// Частичное обновление (merge: true) — можно сохранять только employees,
// только gradeTargets или только assignments, не перезаписывая остальное.
export async function saveTalentMapData(ownerUid, data) {
  if (!ownerUid) throw new Error('ownerUid обязателен для сохранения карты талантов');
  await setDoc(talentMapRef(ownerUid), { ...data, ownerUid, updatedAt: serverTimestamp() }, { merge: true });
}
