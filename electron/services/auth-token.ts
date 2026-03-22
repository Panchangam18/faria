import { initDatabase } from '../db/sqlite';

const FIREBASE_API_KEY = 'AIzaSyA7222J2l9CiCMrX6xMUkIVkiTGC88pSas';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

let cachedIdToken: string | null = null;
let cachedRefreshToken: string | null = null;
let tokenExpiryMs = 0;
let refreshPromise: Promise<string | null> | null = null;

function decodeJwtExp(token: string): number {
  const payload = token.split('.')[1];
  if (!payload) return 0;
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return (decoded.exp || 0) * 1000;
}

export function setTokens(idToken: string | null, refreshToken: string | null): void {
  if (idToken) {
    cachedIdToken = idToken;
    tokenExpiryMs = decodeJwtExp(idToken);
  }
  if (refreshToken) {
    cachedRefreshToken = refreshToken;
    const db = initDatabase();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('firebaseRefreshToken', refreshToken);
  }
}

export function clearTokens(): void {
  cachedIdToken = null;
  cachedRefreshToken = null;
  tokenExpiryMs = 0;
  refreshPromise = null;
  const db = initDatabase();
  db.prepare('DELETE FROM settings WHERE key = ?').run('firebaseRefreshToken');
}

export function loadTokensFromDb(): void {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('firebaseRefreshToken') as { value: string } | undefined;
  if (row?.value) {
    cachedRefreshToken = row.value;
    console.log('[Auth] Loaded refresh token from database');
  }
}

async function refreshIdToken(): Promise<string | null> {
  if (!cachedRefreshToken) return null;

  try {
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(cachedRefreshToken)}`,
    });

    if (!response.ok) {
      console.error('[Auth] Token refresh failed:', response.status);
      clearTokens();
      return null;
    }

    const data = await response.json() as { id_token: string; refresh_token: string; expires_in: string };
    cachedIdToken = data.id_token;
    cachedRefreshToken = data.refresh_token;
    tokenExpiryMs = Date.now() + parseInt(data.expires_in, 10) * 1000;

    // Persist updated refresh token
    const db = initDatabase();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('firebaseRefreshToken', data.refresh_token);

    console.log('[Auth] Token refreshed successfully');
    return cachedIdToken;
  } catch (err) {
    console.error('[Auth] Token refresh error:', err);
    clearTokens();
    return null;
  }
}

export async function getValidToken(): Promise<string | null> {
  // Token still valid
  if (cachedIdToken && Date.now() < tokenExpiryMs - REFRESH_BUFFER_MS) {
    return cachedIdToken;
  }

  // Need to refresh — deduplicate concurrent calls
  if (!refreshPromise) {
    refreshPromise = refreshIdToken().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}
