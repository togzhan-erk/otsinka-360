import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';

export async function getClients() {
  const snap = await getDocs(collection(db, 'clients'));
  const clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  clients.sort((a, b) => {
    const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return bt - at;
  });
  return clients;
}

// Client creation itself happens server-side (api/create-client.js, using
// the Firebase Admin SDK) — the client SDK can't create other users without
// signing the current one out. We just carry the current user's idToken so
// the server can verify the caller is really the superadmin.
export async function createClient({ idToken, email, password, companyName }) {
  const res = await fetch('/api/create-client', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken, email, password, companyName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Не удалось создать клиента.');
  }
  return data;
}
