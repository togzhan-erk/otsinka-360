import { signInWithEmailAndPassword, onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';

export const SUPERADMIN_EMAIL = 'elctogzhan@gmail.com';

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

// Fires immediately with the current user (or null), then on every
// sign-in/sign-out. Returns the unsubscribe function.
export function subscribeToAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export function isSuperadmin(user) {
  return !!user && user.email === SUPERADMIN_EMAIL;
}
