import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Must match src/auth.js's SUPERADMIN_EMAIL — kept as a separate constant
// here since serverless functions run in a different runtime and can't
// import client-side source.
export const SUPERADMIN_EMAIL = 'elctogzhan@gmail.com';

// Shared, defensive Firebase Admin SDK bootstrap for every serverless
// function that needs it. Reads the service account from
// FIREBASE_SERVICE_ACCOUNT (never hardcoded, never sent to the client),
// guards JSON.parse, and un-escapes private_key newlines — env var UIs
// frequently store multi-line values with literal "\n" sequences instead of
// real line breaks, which otherwise breaks cert()'s key parsing.
// initializeApp() is only ever called once per cold start (guarded via
// getApps().length), since Vercel can reuse the same runtime across
// invocations.
export function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not configured');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (err) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
  }

  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }

  return initializeApp({ credential: cert(serviceAccount) });
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

export { FieldValue };
