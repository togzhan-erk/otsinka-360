// All client-management operations go through serverless functions backed
// by the Firebase Admin SDK — the client SDK can't create/disable/delete
// other Firebase Auth users, and can't read another owner's cycles under
// firestore.rules either (needed for the per-client activity stats). Every
// call carries the current user's idToken so the server can verify the
// caller is really the superadmin before doing anything.

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || 'Запрос не выполнен.');
  }
  return data;
}

// Returns clients enriched with activity stats (cyclesCount, employeesCount)
// and current access status — computed server-side via the Admin SDK.
export async function listClients({ idToken }) {
  const data = await postJson('/api/list-clients', { idToken });
  return data.clients || [];
}

export async function createClient({ idToken, email, password, companyName }) {
  return postJson('/api/create-client', { idToken, email, password, companyName });
}

export async function setClientAccess({ idToken, uid, active }) {
  return postJson('/api/set-client-access', { idToken, uid, active });
}

export async function resetClientPassword({ idToken, uid, newPassword }) {
  return postJson('/api/reset-client-password', { idToken, uid, newPassword });
}

export async function deleteClientAccount({ idToken, uid }) {
  return postJson('/api/delete-client', { idToken, uid });
}
