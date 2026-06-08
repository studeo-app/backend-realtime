import admin from "firebase-admin";

export function initializeFirebase(): void {
  if (!admin.apps.length) {
    const projectId = process.env["FIREBASE_PROJECT_ID"];
    const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"];
    const privateKey = process.env["FIREBASE_PRIVATE_KEY"]?.replace(/\\n/g, "\n");

    const certConfig: admin.ServiceAccount = {};
    if (projectId) certConfig.projectId = projectId;
    if (clientEmail) certConfig.clientEmail = clientEmail;
    if (privateKey) certConfig.privateKey = privateKey;

    admin.initializeApp({
      credential: admin.credential.cert(certConfig),
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
