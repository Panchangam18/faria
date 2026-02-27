import { BrowserWindow } from 'electron';

const FIREBASE_API_KEY = 'AIzaSyA7222J2l9CiCMrX6xMUkIVkiTGC88pSas';
const FIREBASE_AUTH_DOMAIN = 'faria-6f4b8.firebaseapp.com';
const REDIRECT_URI = `https://${FIREBASE_AUTH_DOMAIN}/__/auth/handler`;

export async function googleSignIn(): Promise<{ success: boolean; email?: string; uid?: string; displayName?: string; photoUrl?: string; error?: string }> {
  // Use Firebase's createAuthUri to get the full Google OAuth URL
  let authUri: string;
  let sessionId: string;
  try {
    const res = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/createAuthUri?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: 'google.com',
          continueUri: REDIRECT_URI,
        }),
      }
    );
    const data = await res.json();
    if (!data.authUri) {
      return { success: false, error: data.error?.message || 'Failed to initialize Google sign-in.' };
    }
    authUri = data.authUri;
    sessionId = data.sessionId;
  } catch {
    return { success: false, error: 'Failed to connect to Firebase.' };
  }

  return new Promise((resolve) => {
    const authWindow = new BrowserWindow({
      width: 500,
      height: 650,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    let resolved = false;

    authWindow.loadURL(authUri);

    // After Google auth, the user is redirected to Firebase's auth handler page.
    // That page receives the id_token in the URL fragment and processes it.
    // We intercept navigation to the auth handler to extract the id_token ourselves.
    authWindow.webContents.on('will-navigate', (_event, url) => {
      handleRedirect(url);
    });

    authWindow.webContents.on('will-redirect', (_event, url) => {
      handleRedirect(url);
    });

    async function handleRedirect(url: string) {
      if (resolved) return;

      // Check if this is the redirect back to the Firebase auth handler with the token
      if (!url.startsWith(REDIRECT_URI)) return;

      // The id_token is in the URL fragment (after #)
      const hashPart = url.split('#')[1];
      if (!hashPart) return;

      const hashParams = new URLSearchParams(hashPart);
      const idToken = hashParams.get('id_token');

      if (!idToken) {
        const error = hashParams.get('error') || 'No token received';
        resolved = true;
        authWindow.close();
        resolve({ success: false, error });
        return;
      }

      try {
        // Exchange the Google ID token for a Firebase user
        const res = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              postBody: `id_token=${idToken}&providerId=google.com`,
              requestUri: REDIRECT_URI,
              returnIdpCredential: true,
              returnSecureToken: true,
              sessionId,
            }),
          }
        );

        const data = await res.json();

        if (data.email && data.localId) {
          resolved = true;
          authWindow.close();
          resolve({ success: true, email: data.email, uid: data.localId, displayName: data.displayName, photoUrl: data.photoUrl });
        } else {
          resolved = true;
          authWindow.close();
          resolve({ success: false, error: data.error?.message || 'Firebase sign-in failed.' });
        }
      } catch (err) {
        resolved = true;
        authWindow.close();
        resolve({ success: false, error: String(err) });
      }
    }

    authWindow.on('closed', () => {
      if (!resolved) {
        resolve({ success: false, error: 'Sign-in window was closed.' });
      }
    });
  });
}
