import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  type FirestoreSettings,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId:
    process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};
const app = getApps().length > 0
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth = getAuth(app);
// Firebase 12 supports this transport option at runtime, although it is not
// exposed in FirestoreSettings. In development, XHR avoids the Fetch-stream
// cancellation path reported in the browser logs. Keep production defaults.
const developmentSettings: FirestoreSettings & { useFetchStreams: boolean } = {
  useFetchStreams: false,
};
export const db = process.env.NODE_ENV === "development"
  ? initializeFirestore(app, developmentSettings)
  : getFirestore(app);

export default app;
