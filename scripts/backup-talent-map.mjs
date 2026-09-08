// Разовый резервный скрипт для «Карты талантов». Читает talentMaps/main и
// всю его подколлекцию responses через Admin SDK, ничего не пишет.
// Сохраняет в один локальный JSON-файл.
//
// Ключ сервисного аккаунта берётся (по приоритету):
//   1. GOOGLE_APPLICATION_CREDENTIALS — путь к JSON-файлу ключа.
//   2. ./service-account.json в корне репозитория, если такой файл есть
//      (кладите его сюда только временно — он в .gitignore и должен быть
//      удалён сразу после использования).
//   3. FIREBASE_SERVICE_ACCOUNT — тот же JSON целиком одной строкой, что
//      использует api/_lib/firebaseAdmin.mjs на Vercel.
//
// Запуск (из корня репозитория), с локальным файлом ключа:
//   node scripts/backup-talent-map.mjs
// или явно указав путь:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/backup-talent-map.mjs
// или из .env/.env.local со значением FIREBASE_SERVICE_ACCOUNT:
//   node --env-file=.env.local scripts/backup-talent-map.mjs

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const TALENT_MAP_DOC_ID = 'main';

async function loadServiceAccount() {
  const explicitPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicitPath) {
    const raw = await readFile(path.resolve(REPO_ROOT, explicitPath), 'utf8');
    return JSON.parse(raw);
  }

  const localKeyPath = path.join(REPO_ROOT, 'service-account.json');
  if (existsSync(localKeyPath)) {
    const raw = await readFile(localKeyPath, 'utf8');
    return JSON.parse(raw);
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    const serviceAccount = JSON.parse(raw);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    return serviceAccount;
  }

  throw new Error(
    'Не найден ключ сервисного аккаунта: ни GOOGLE_APPLICATION_CREDENTIALS, ни service-account.json в корне, ни FIREBASE_SERVICE_ACCOUNT'
  );
}

async function getDb() {
  if (getApps().length > 0) return getFirestore(getApps()[0]);
  const serviceAccount = await loadServiceAccount();
  const app = initializeApp({ credential: cert(serviceAccount) });
  return getFirestore(app);
}

async function main() {
  const db = await getDb();

  const mainRef = db.collection('talentMaps').doc(TALENT_MAP_DOC_ID);
  const mainSnap = await mainRef.get();
  if (!mainSnap.exists) {
    throw new Error(`talentMaps/${TALENT_MAP_DOC_ID} не найден — нечего резервировать`);
  }
  const mainData = mainSnap.data();

  const responsesSnap = await mainRef.collection('responses').get();
  const responses = {};
  responsesSnap.forEach((doc) => {
    responses[doc.id] = doc.data();
  });

  const backup = {
    exportedAt: new Date().toISOString(),
    docId: TALENT_MAP_DOC_ID,
    employeeCount: (mainData.employees || []).length,
    responseCount: responsesSnap.size,
    main: mainData,
    responses,
  };

  const outDir = path.join(REPO_ROOT, 'scripts', 'backups');
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `talent-backup-${stamp}.json`);

  await writeFile(outPath, JSON.stringify(backup, null, 2), 'utf8');

  console.log(`Сохранено: ${outPath}`);
  console.log(`Сотрудников: ${backup.employeeCount}, ответов (responses): ${backup.responseCount}`);
}

main().catch((err) => {
  console.error('[backup-talent-map] Ошибка:', err);
  process.exitCode = 1;
});
