import { BrowserWindow } from 'electron';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyA7222J2l9CiCMrX6xMUkIVkiTGC88pSas',
  authDomain: 'faria-6f4b8.firebaseapp.com',
  projectId: 'faria-6f4b8',
  storageBucket: 'faria-6f4b8.firebasestorage.app',
  messagingSenderId: '1002852709892',
  appId: '1:1002852709892:web:3c5fd2ebe290aa6e68e751',
};

function buildAuthHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Sign in with Google</title>
  <style>
    body {
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
    }
    .status { font-size: 14px; text-align: center; }
    .error { color: #e94560; }
  </style>
</head>
<body>
  <div class="status" id="status">Opening Google Sign-In...</div>
  <script type="module">
    import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
    import { getAuth, signInWithPopup, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';

    const app = initializeApp(${JSON.stringify(FIREBASE_CONFIG)});
    const auth = getAuth(app);
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');

    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      document.title = JSON.stringify({
        success: true,
        email: user.email,
        uid: user.uid,
      });
    } catch (err) {
      document.getElementById('status').className = 'status error';
      document.getElementById('status').textContent = 'Sign-in failed: ' + err.message;
      document.title = JSON.stringify({
        success: false,
        error: err.message,
      });
    }
  </script>
</body>
</html>`;
}

export async function googleSignIn(): Promise<{ success: boolean; email?: string; uid?: string; error?: string }> {
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

    authWindow.webContents.on('page-title-updated', (_event, title) => {
      try {
        const result = JSON.parse(title);
        if (result.success !== undefined) {
          resolved = true;
          authWindow.close();
          resolve(result);
        }
      } catch {
        // Title isn't our JSON result yet, ignore
      }
    });

    authWindow.on('closed', () => {
      if (!resolved) {
        resolve({ success: false, error: 'Sign-in window was closed.' });
      }
    });

    authWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildAuthHTML())}`);
  });
}
