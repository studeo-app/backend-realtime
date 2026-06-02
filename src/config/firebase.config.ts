import admin from "firebase-admin";

export function initializeFirebase(): void {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    });
  }
}

export const firebaseAdmin = admin;

export function getFirestore(): FirebaseFirestore.Firestore {
  return firebaseAdmin.firestore();
}

export function getFirebaseAuth(): admin.auth.Auth {
  return firebaseAdmin.auth();
}
