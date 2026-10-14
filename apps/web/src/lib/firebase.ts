import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  clearIndexedDbPersistence,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
} from 'firebase/firestore';

const env = import.meta.env;

export const firebaseApp = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(firebaseApp);
/**
 * Feature 005 (research R1): persistent cache so the data already seen (trips, members, visible
 * expenses, payments) is readable offline. Rules still apply: only readable docs are cached.
 * 40 MB here + ~10 MB of persisted API queries ≈ the 50 MB budget per account.
 */
export const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
    cacheSizeBytes: 40 * 1024 * 1024,
  }),
});

/** Wipes the Firestore offline cache; the instance is unusable afterwards (the app reloads). */
export async function clearFirestoreCache(): Promise<void> {
  await terminate(db);
  await clearIndexedDbPersistence(db);
}

export const usingEmulators = env.VITE_USE_EMULATORS === 'true';

if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
