import {
  collection, doc, getDoc, getDocs, setDoc,
  query, where, limit, serverTimestamp, runTransaction, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { DEFAULT_TRACK } from './competencies';

// ── Cycle reads ───────────────────────────────────────────────────────────

// Always called with the signed-in admin's uid in practice — ownerUid is
// kept optional at the function level only as a defensive default.
export async function getActiveCycle(ownerUid) {
  const clauses = [where('status', '==', 'active')];
  if (ownerUid) clauses.push(where('ownerUid', '==', ownerUid));
  const q = query(collection(db, 'cycles'), ...clauses, limit(1));
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

export async function getArchivedCycles(ownerUid) {
  if (!ownerUid) return [];
  const q = query(
    collection(db, 'cycles'),
    where('status', '==', 'archived'),
    where('ownerUid', '==', ownerUid)
  );
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

// ── AI-generated individual development plan (IPR) ─────────────────────────
//
// Keyed by employee name (not id) within the cycle — matches how the rest
// of the app already looks employees up for reports, since some feedback
// docs (the manual no-invite-link rater flow) don't carry a real employee id.

function iprDocRef(cycleId, employeeName) {
  return doc(db, 'cycles', cycleId, 'ipr', encodeURIComponent(employeeName));
}

export async function getSavedIpr(cycleId, employeeName) {
  if (!cycleId || !employeeName) return null;
  const snap = await getDoc(iprDocRef(cycleId, employeeName));
  return snap.exists() ? snap.data() : null;
}

export async function saveIpr(cycleId, employeeName, text) {
  const cycleSnap = await getDoc(doc(db, 'cycles', cycleId));
  const ownerUid = cycleSnap.exists() ? (cycleSnap.data().ownerUid || null) : null;
  await setDoc(iprDocRef(cycleId, employeeName), { text, generatedAt: serverTimestamp(), ownerUid });
}

export async function createCycle(name, ownerUid) {
  const ref = doc(collection(db, 'cycles'));
  await setDoc(ref, {
    name,
    status: 'active',
    createdAt: serverTimestamp(),
    employees: [],
    roleAssignments: [],
    ownerUid,
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

// ── One-time backfill: attribute every pre-auth cycle (created before
// per-owner data isolation existed) to the superadmin, so existing test
// data isn't orphaned once cycle reads/writes start being scoped by
// ownerUid. Only ever touches cycles that don't already have an owner —
// safe to call on every superadmin login. Guarded the same way as the
// other one-time migrations (transactional lock on meta/ownerMigration).
export async function migrateCycleOwnersIfNeeded(superadminUid) {
  if (!superadminUid) return;

  const migrationRef = doc(db, 'meta', 'ownerMigration');
  let wonRace = false;
  try {
    await runTransaction(db, async (tx) => {
      const migSnap = await tx.get(migrationRef);
      if (migSnap.exists() && migSnap.data().done) return;
      tx.set(migrationRef, { done: true, migratedAt: serverTimestamp() });
      wonRace = true;
    });
  } catch (err) {
    console.error('[cycles] Owner migration lock transaction failed:', err);
    return;
  }
  if (!wonRace) return;

  console.log('[cycles] Running one-time backfill of cycle ownership to superadmin...');
  try {
    const allCycles = await getDocs(collection(db, 'cycles'));
    for (const cycleDoc of allCycles.docs) {
      if (cycleDoc.data().ownerUid) continue;
      await setDoc(doc(db, 'cycles', cycleDoc.id), { ownerUid: superadminUid }, { merge: true });
    }
    console.log('[cycles] Owner backfill complete.');
  } catch (err) {
    console.error('[cycles] Owner backfill failed:', err);
  }
}

// ── One-time backfill: propagate each cycle's own ownerUid down onto its
// feedback and ipr subcollection documents. Those are separate Firestore
// documents (not fields on the cycle doc), so strict per-owner security
// rules need ownerUid on each of them directly to avoid extra get() calls
// inside the rules. Only touches cycles that already have an owner
// themselves (i.e. run this after migrateCycleOwnersIfNeeded has had a
// chance to run), and only sub-documents that don't already have one.
// Guarded the same way as the other one-time migrations.
export async function migrateSubDocOwnersIfNeeded() {
  const migrationRef = doc(db, 'meta', 'subDocOwnerMigration');
  let wonRace = false;
  try {
    await runTransaction(db, async (tx) => {
      const migSnap = await tx.get(migrationRef);
      if (migSnap.exists() && migSnap.data().done) return;
      tx.set(migrationRef, { done: true, migratedAt: serverTimestamp() });
      wonRace = true;
    });
  } catch (err) {
    console.error('[cycles] Sub-doc owner migration lock transaction failed:', err);
    return;
  }
  if (!wonRace) return;

  console.log('[cycles] Running one-time backfill of feedback/ipr ownerUid...');
  try {
    const allCycles = await getDocs(collection(db, 'cycles'));
    for (const cycleDoc of allCycles.docs) {
      const ownerUid = cycleDoc.data().ownerUid;
      if (!ownerUid) continue; // no owner yet on the cycle itself — nothing to propagate

      const feedbackSnap = await getDocs(collection(db, 'cycles', cycleDoc.id, 'feedback'));
      for (let i = 0; i < feedbackSnap.docs.length; i += 400) {
        const chunk = feedbackSnap.docs.slice(i, i + 400).filter(fd => !fd.data().ownerUid);
        if (chunk.length === 0) continue;
        const batch = writeBatch(db);
        chunk.forEach(fd => {
          batch.set(doc(db, 'cycles', cycleDoc.id, 'feedback', fd.id), { ownerUid }, { merge: true });
        });
        await batch.commit();
      }

      const iprSnap = await getDocs(collection(db, 'cycles', cycleDoc.id, 'ipr'));
      for (const iprDocSnap of iprSnap.docs) {
        if (!iprDocSnap.data().ownerUid) {
          await setDoc(doc(db, 'cycles', cycleDoc.id, 'ipr', iprDocSnap.id), { ownerUid }, { merge: true });
        }
      }
    }
    console.log('[cycles] Sub-doc owner backfill complete.');
  } catch (err) {
    console.error('[cycles] Sub-doc owner backfill failed:', err);
  }
}
