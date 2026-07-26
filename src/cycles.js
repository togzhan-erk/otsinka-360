import {
  collection, doc, getDoc, getDocs, setDoc,
  query, where, limit, serverTimestamp, runTransaction, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { DEFAULT_TRACK } from './competencies';

// ── Cycle reads ───────────────────────────────────────────────────────────

export async function getActiveCycle() {
  const q = query(collection(db, 'cycles'), where('status', '==', 'active'), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function getCycle(cycleId) {
  if (!cycleId) return null;
  const snap = await getDoc(doc(db, 'cycles', cycleId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getCycleFeedback(cycleId) {
  const snap = await getDocs(collection(db, 'cycles', cycleId, 'feedback'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getArchivedCycles() {
  const q = query(collection(db, 'cycles'), where('status', '==', 'archived'));
  const snap = await getDocs(q);
  const cycles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cycles.sort((a, b) => {
    const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return bt - at;
  });
  return cycles;
}

// ── Cycle writes ──────────────────────────────────────────────────────────

export async function saveCycleData(cycleId, { employees, roleAssignments }) {
  await setDoc(doc(db, 'cycles', cycleId), { employees, roleAssignments }, { merge: true });
}

export async function archiveCycle(cycleId) {
  await setDoc(doc(db, 'cycles', cycleId), { status: 'archived' }, { merge: true });
}

// Writes a feedback doc and, if assignmentId is given, flags that one
// assignment as completed in the same transaction. The feedback payload
// itself is untouched (no rater identity in it) — completion is tracked
// purely on the roleAssignments array, which is how anonymity is kept
// even though admins can see who has/hasn't responded.
export async function submitFeedback(cycleId, assignmentId, feedbackPayload) {
  const cycleRef = doc(db, 'cycles', cycleId);
  const feedbackRef = doc(collection(db, 'cycles', cycleId, 'feedback'));
  await runTransaction(db, async (tx) => {
    if (assignmentId) {
      const cycleSnap = await tx.get(cycleRef);
      if (cycleSnap.exists()) {
        const assignments = cycleSnap.data().roleAssignments || [];
        const updated = assignments.map(a =>
          String(a.id) === String(assignmentId)
            ? { ...a, completed: true, completedAt: new Date() }
            : a
        );
        tx.set(cycleRef, { roleAssignments: updated }, { merge: true });
      }
    }
    tx.set(feedbackRef, feedbackPayload);
  });
  return feedbackRef.id;
}

export async function createCycle(name) {
  const ref = doc(collection(db, 'cycles'));
  await setDoc(ref, {
    name,
    status: 'active',
    createdAt: serverTimestamp(),
    employees: [],
    roleAssignments: [],
  });
  return ref.id;
}

// ── One-time migration of pre-cycle data (projects/active + feedback) ─────
//
// Guarded twice: first by "does the cycles collection already have any
// document" (fast path, no writes), then by a transactional lock on
// meta/migration so two clients racing on an empty DB can't both create
// a first cycle. Never deletes the legacy projects/active doc or the old
// top-level feedback collection — they're left untouched as a backup.
export async function migrateLegacyDataIfNeeded() {
  const existing = await getDocs(query(collection(db, 'cycles'), limit(1)));
  if (!existing.empty) return;

  const migrationRef = doc(db, 'meta', 'migration');
  let wonRace = false;
  try {
    await runTransaction(db, async (tx) => {
      const migSnap = await tx.get(migrationRef);
      if (migSnap.exists() && migSnap.data().done) return;
      tx.set(migrationRef, { done: true, migratedAt: serverTimestamp() });
      wonRace = true;
    });
  } catch (err) {
    console.error('[cycles] Migration lock transaction failed:', err);
    return;
  }
  if (!wonRace) return;

  console.log('[cycles] Running one-time migration into first cycle...');
  try {
    const legacyProjectSnap = await getDoc(doc(db, 'projects', 'active'));
    const legacyProject = legacyProjectSnap.exists() ? legacyProjectSnap.data() : null;
    const legacyFeedbackSnap = await getDocs(collection(db, 'feedback'));

    const newCycleRef = doc(collection(db, 'cycles'));
    await setDoc(newCycleRef, {
      name: 'Опрос 1',
      status: 'active',
      createdAt: legacyProject?.savedAt || serverTimestamp(),
      employees: legacyProject?.employees || [],
      roleAssignments: legacyProject?.roleAssignments || [],
    });

    const feedbackDocs = legacyFeedbackSnap.docs;
    for (let i = 0; i < feedbackDocs.length; i += 400) {
      const batch = writeBatch(db);
      feedbackDocs.slice(i, i + 400).forEach(fd => {
        batch.set(doc(db, 'cycles', newCycleRef.id, 'feedback', fd.id), fd.data());
      });
      await batch.commit();
    }

    console.log('[cycles] Migration complete. Cycle id:', newCycleRef.id, 'feedback docs copied:', feedbackDocs.length);
  } catch (err) {
    console.error('[cycles] Migration failed:', err);
  }
}

// ── One-time backfill: give every existing employee (in every cycle,
// active or archived) an explicit competency track. Employees created
// before tracks existed default to "standard" so past data stays valid.
// Guarded the same way as migrateLegacyDataIfNeeded — a transactional lock
// on meta/tracksMigration so it only ever runs once, even with concurrent
// clients on an unmigrated database.
export async function migrateEmployeeTracksIfNeeded() {
  const migrationRef = doc(db, 'meta', 'tracksMigration');
  let wonRace = false;
  try {
    await runTransaction(db, async (tx) => {
      const migSnap = await tx.get(migrationRef);
      if (migSnap.exists() && migSnap.data().done) return;
      tx.set(migrationRef, { done: true, migratedAt: serverTimestamp() });
      wonRace = true;
    });
  } catch (err) {
    console.error('[cycles] Track migration lock transaction failed:', err);
    return;
  }
  if (!wonRace) return;

  console.log('[cycles] Running one-time backfill of default competency track...');
  try {
    const allCycles = await getDocs(collection(db, 'cycles'));
    for (const cycleDoc of allCycles.docs) {
      const employeesList = cycleDoc.data().employees || [];
      if (employeesList.length === 0) continue;
      if (employeesList.every(e => e.track)) continue;
      const updated = employeesList.map(e => ({ ...e, track: e.track || DEFAULT_TRACK }));
      await setDoc(doc(db, 'cycles', cycleDoc.id), { employees: updated }, { merge: true });
    }
    console.log('[cycles] Track backfill complete.');
  } catch (err) {
    console.error('[cycles] Track backfill failed:', err);
  }
}
