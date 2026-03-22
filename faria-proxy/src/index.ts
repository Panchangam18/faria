interface Env {
  SERPER_API_KEY: string;
  OPENAI_API_KEY: string;
  COMPOSIO_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_API_KEY: string;
  RATE_LIMITS: KVNamespace;
}

const FIREBASE_PROJECT_ID = 'faria-6f4b8';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let jwksCache: { keys: Record<string, CryptoKey>; fetchedAt: number } | null = null;

const LIMITS: Record<string, number> = {
  serper: 100,
  openai: 200,
  composio: 300,
  anthropic: 50,
  google: 50,
};

// ── JWT Verification ──

function base64UrlDecode(str: string): string {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

function base64UrlToBytes(str: string): Uint8Array {
  const binary = base64UrlDecode(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getPublicKeys(): Promise<Record<string, CryptoKey>> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < CACHE_TTL_MS) {
    return jwksCache.keys;
  }
  // Use the JWK endpoint instead of x509 certs — much easier to import
  const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  const jwks: { keys: Array<JsonWebKey & { kid: string }> } = await res.json();
  const keys: Record<string, CryptoKey> = {};
  for (const jwk of jwks.keys) {
    keys[jwk.kid] = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
  }
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

async function verifyFirebaseToken(authHeader: string): Promise<{ uid: string } | null> {
  try {
    if (!authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);

    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;

    const header: { kid?: string; alg?: string } = JSON.parse(base64UrlDecode(headerB64));
    const payload: { iss?: string; aud?: string; exp?: number; iat?: number; sub?: string } = JSON.parse(base64UrlDecode(payloadB64));

    // Validate claims
    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
    if (payload.aud !== FIREBASE_PROJECT_ID) return null;
    if (!payload.exp || payload.exp < now) return null;
    if (!payload.iat || payload.iat > now + 10) return null;
    if (!payload.sub || typeof payload.sub !== 'string') return null;

    // Verify signature
    const keys = await getPublicKeys();
    if (!header.kid || !keys[header.kid]) return null;

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sigBytes = base64UrlToBytes(signatureB64);

    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys[header.kid], sigBytes, data);
    if (!valid) return null;

    return { uid: payload.sub };
  } catch (err) {
    console.error('[Auth] JWT verification error:', err);
    return null;
  }
}

// ── Rate Limiting ──

async function checkRateLimit(
  kv: KVNamespace,
  uid: string,
  service: string
): Promise<boolean> {
  const hour = new Date().toISOString().slice(0, 13);
  const key = `ratelimit:${uid}:${service}:${hour}`;
  const current = parseInt((await kv.get(key)) || '0', 10);
  if (current >= (LIMITS[service] || 100)) return false;
  await kv.put(key, String(current + 1), { expirationTtl: 7200 });
  return true;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Firebase-Token, x-api-key, anthropic-version, anthropic-beta',
  };
}

// ── Main Handler ──

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error('[Worker] Unhandled error:', err);
      return Response.json({ error: 'Internal server error', detail: String(err) }, { status: 500, headers: corsHeaders() });
    }
  },
};

async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);

  // Verify Firebase JWT (sent via custom header to avoid conflict with SDK auth headers)
  const firebaseToken = request.headers.get('X-Firebase-Token') || '';
  const authResult = await verifyFirebaseToken('Bearer ' + firebaseToken);
  if (!authResult) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders() });
  }
    const uid = authResult.uid;
    const path = url.pathname;

    // Route: Serper
    if (path.startsWith('/serper/')) {
      if (!(await checkRateLimit(env.RATE_LIMITS, uid, 'serper'))) {
        return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...corsHeaders(), 'Retry-After': '3600' } });
      }
      const upstream = 'https://google.serper.dev' + path.replace('/serper', '');
      return proxy(request, upstream, { 'X-API-KEY': env.SERPER_API_KEY });
    }

    // Route: OpenAI (embeddings + chat)
    if (path.startsWith('/openai/')) {
      if (!(await checkRateLimit(env.RATE_LIMITS, uid, 'openai'))) {
        return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...corsHeaders(), 'Retry-After': '3600' } });
      }
      const upstream = 'https://api.openai.com' + path.replace('/openai', '');
      return proxy(request, upstream, { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` });
    }

    // Route: Anthropic
    if (path.startsWith('/anthropic/')) {
      if (!(await checkRateLimit(env.RATE_LIMITS, uid, 'anthropic'))) {
        return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...corsHeaders(), 'Retry-After': '3600' } });
      }
      const upstream = 'https://api.anthropic.com' + path.replace('/anthropic', '');
      return proxy(request, upstream, { 'x-api-key': env.ANTHROPIC_API_KEY });
    }

    // Route: Google Gemini
    if (path.startsWith('/google/')) {
      if (!(await checkRateLimit(env.RATE_LIMITS, uid, 'google'))) {
        return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...corsHeaders(), 'Retry-After': '3600' } });
      }
      const upstreamUrl = new URL('https://generativelanguage.googleapis.com' + path.replace('/google', ''));
      for (const [k, v] of url.searchParams.entries()) {
        if (k !== 'key') upstreamUrl.searchParams.set(k, v);
      }
      upstreamUrl.searchParams.set('key', env.GOOGLE_API_KEY);
      return proxy(request, upstreamUrl.toString(), {});
    }

    // Route: Composio
    if (path.startsWith('/composio/')) {
      if (!(await checkRateLimit(env.RATE_LIMITS, uid, 'composio'))) {
        return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...corsHeaders(), 'Retry-After': '3600' } });
      }
      const upstream = 'https://backend.composio.dev' + path.replace('/composio', '');
      return proxy(request, upstream, { 'x-api-key': env.COMPOSIO_API_KEY });
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders() });
}

// ── Proxy ──

async function proxy(
  request: Request,
  upstream: string,
  authHeaders: Record<string, string>
): Promise<Response> {
  const headers = new Headers(request.headers);

  // Strip incoming auth headers
  headers.delete('Authorization');
  headers.delete('X-API-KEY');
  headers.delete('x-api-key');
  headers.delete('X-Firebase-Token');

  // Inject real keys
  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }

  headers.delete('host');

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method !== 'GET' ? request.body : undefined,
  });

  const responseHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    responseHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
