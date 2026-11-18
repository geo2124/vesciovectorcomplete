import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  setLogLevel,
  type Firestore,
} from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, type Functions } from "firebase/functions";
import firebaseConfig from "../../firebase-applet-config.json";

export const FIRESTORE_DATABASE_ID = "donbosco";

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

if (typeof window !== "undefined") {
  setLogLevel("silent"); // Suppress Firebase offline warnings
}

function createFirestoreInstance(): Firestore {
  if (typeof window === "undefined") {
    return {} as unknown as Firestore;
  }

  // Explicitly target the "donbosco" database instance (never fallback to default)
  const targetDatabaseId =
    firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId.trim() !== ""
      ? firebaseConfig.firestoreDatabaseId.trim()
      : FIRESTORE_DATABASE_ID;

  // 1. Check window cache to prevent re-initialization during Vite HMR
  const win = window as unknown as { __vv_firestore_instances?: Record<string, Firestore> };
  win.__vv_firestore_instances = win.__vv_firestore_instances || {};
  if (win.__vv_firestore_instances[targetDatabaseId]) {
    return win.__vv_firestore_instances[targetDatabaseId];
  }

  // 2. Initialize Firestore FIRST with multi-tab persistent IndexedDB cache, falling back to getFirestore only if already initialized during hot reload
  let firestoreInstance: Firestore;
  try {
    const localCache =
      typeof indexedDB !== "undefined"
        ? persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          })
        : memoryLocalCache();

    firestoreInstance = initializeFirestore(
      app,
      {
        localCache,
        experimentalAutoDetectLongPolling: true,
        ignoreUndefinedProperties: true,
      },
      targetDatabaseId,
    );
  } catch (err: unknown) {
    console.warn("initializeFirestore already called, returning getFirestore instance:", err);
    firestoreInstance = getFirestore(app, targetDatabaseId);
  }

  win.__vv_firestore_instances[targetDatabaseId] = firestoreInstance;
  return firestoreInstance;
}

export const db: Firestore = createFirestoreInstance();

export const auth: Auth =
  typeof window !== "undefined"
    ? ((window as unknown as { __vv_auth?: Auth }).__vv_auth =
        (window as unknown as { __vv_auth?: Auth }).__vv_auth || getAuth(app))
    : ({} as unknown as Auth);

export const storage: FirebaseStorage =
  typeof window !== "undefined"
    ? ((window as unknown as { __vv_storage?: FirebaseStorage }).__vv_storage =
        (window as unknown as { __vv_storage?: FirebaseStorage }).__vv_storage || getStorage(app))
    : ({} as unknown as FirebaseStorage);

export const functions: Functions =
  typeof window !== "undefined"
    ? ((window as unknown as { __vv_functions?: Functions }).__vv_functions =
        (window as unknown as { __vv_functions?: Functions }).__vv_functions ||
        getFunctions(app, "europe-west2"))
    : ({} as unknown as Functions);
