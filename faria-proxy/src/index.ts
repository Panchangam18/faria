interface Env {
  SERPER_API_KEY: string;
  OPENAI_API_KEY: string;
  COMPOSIO_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_API_KEY: string;
  FARIA_APP_TOKEN: string;
  RATE_LIMITS: KVNamespace;
}

const LIMITS: Record<string, number> = {
  serper: 100,
  openai: 200,
  composio: 300,
  anthropic: 50,
  google: 50,
};

async function checkRateLimit(
  kv: KVNamespace,
  ip: string,
  service: string
): Promise<boolean> {
  const hour = new Date().toISOString().slice(0, 13); // e.g. "2026-03-22T14"
  const key = `ratelimit:${ip}:${service}:${hour}`;
  const current = parseInt((await kv.get(key)) || '0', 10);
  if (current >= (LIMITS[service] || 100)) return false;
  await kv.put(key, String(current + 1), { expirationTtl: 7200 });
  return true;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Faria-Token, Authorization, x-api-key, anthropic-version, anthropic-beta',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Validate app token
    const token = request.headers.get('X-Faria-Token');
    if (token !== env.FARIA_APP_TOKEN) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // Route: Serper
    if (path.startsWith('/serper/')) {
      if (!(await checkRateLimit(env.RATE_LIMITS, ip, 'serper'))) {
        return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...corsHeaders(), 'Retry-After': '3600' } });
      }
      const upstream = 'https://google.serper.dev' + path.replace('/serper', '');
      return proxy(request, upstream, { 'X-API-KEY': env.SERPER_API_KEY });
    }

    // Route: OpenAI (embeddings + chat)
    if (path.startsWith('/openai/')) {
      if (!(await checkRateLimit(env.RATE_LIMITS, ip, 'openai'))) {
        return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...corsHeaders(), 'Retry-After': '3600' } });
      }
      const upstream = 'https://api.openai.com' + path.replace('/openai', '');
      return proxy(request, upstream, { 'Authorization': `Bearer ${env.OPENAI_API_KEY}` });
    }

    // Route: Anthropic
    if (path.startsWith('/anthropic/')) {
      if (!(await checkRateLimit(env.RATE_LIMITS, ip, 'anthropic'))) {
        return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...corsHeaders(), 'Retry-After': '3600' } });
      }
      const upstream = 'https://api.anthropic.com' + path.replace('/anthropic', '');
      return proxy(request, upstream, { 'x-api-key': env.ANTHROPIC_API_KEY });
    }

    // Route: Google Gemini
    if (path.startsWith('/google/')) {
      if (!(await checkRateLimit(env.RATE_LIMITS, ip, 'google'))) {
        return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...corsHeaders(), 'Retry-After': '3600' } });
      }
      // Google uses API key as query param — preserve all original query params and override key
      const upstreamUrl = new URL('https://generativelanguage.googleapis.com' + path.replace('/google', ''));
      // Copy all query params from the incoming request
      for (const [k, v] of url.searchParams.entries()) {
        if (k !== 'key') upstreamUrl.searchParams.set(k, v);
      }
      upstreamUrl.searchParams.set('key', env.GOOGLE_API_KEY);
      return proxy(request, upstreamUrl.toString(), {});
    }

    // Route: Composio
    if (path.startsWith('/composio/')) {
      if (!(await checkRateLimit(env.RATE_LIMITS, ip, 'composio'))) {
        return Response.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...corsHeaders(), 'Retry-After': '3600' } });
      }
      const upstream = 'https://backend.composio.dev' + path.replace('/composio', '');
      return proxy(request, upstream, { 'x-api-key': env.COMPOSIO_API_KEY });
    }

    return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders() });
  },
};

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
  headers.delete('X-Faria-Token');

  // Inject real keys
  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }

  // Remove headers that shouldn't be forwarded
  headers.delete('host');

  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method !== 'GET' ? request.body : undefined,
  });

  // Stream the response back with CORS headers
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
