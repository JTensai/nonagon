import { firebaseConfig, FIREBASE_SDK_VERSION } from './config.js';

export const firebaseEnabled = Boolean(firebaseConfig.apiKey);

let loaded = null;

// Firebase is loaded on demand from Google's CDN, so demo mode never touches it.
export function fire() {
  if (!loaded) {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/`;
    loaded = Promise.all([
      import(base + 'firebase-app.js'),
      import(base + 'firebase-auth.js'),
      import(base + 'firebase-firestore.js'),
    ]).then(([appMod, au, fs]) => {
      const app = appMod.initializeApp(firebaseConfig);
      const auth = au.getAuth(app);
      const db = fs.getFirestore(app);
      return { app, auth, db, au, fs };
    });
  }
  return loaded;
}
