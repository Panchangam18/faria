import { app } from 'electron';
import { initDatabase } from '../db/sqlite';
import { getValidToken } from './auth-token';

const getProxyBase = () => process.env.FARIA_PROXY_BASE || 'https://faria-proxy.madhavan.workers.dev';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

interface FetchConfig {
  url: string;
  headers: Record<string, string>;
}

interface LLMProxyConfig {
  apiKey: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
}

/**
 * Check if user has their own key for a provider in SQLite settings.
 */
function getUserKey(settingKey: string): string | null {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey) as { value: string } | undefined;
  return row?.value || null;
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await getValidToken();
  if (!token) throw new Error('Not signed in — please sign in to use Faria');
  return { 'X-Firebase-Token': token };
}

// ── Serper ──

export async function getSerperConfig(path: string = '/search'): Promise<FetchConfig> {
  const userKey = process.env.SERPER_API_KEY;
  if (userKey || isDev) {
    return {
      url: `https://google.serper.dev${path}`,
      headers: userKey ? { 'X-API-KEY': userKey } : {},
    };
  }
  return {
    url: `${getProxyBase()}/serper${path}`,
    headers: await getAuthHeader(),
  };
}

// ── OpenAI Embeddings ──

export async function getOpenAIEmbeddingConfig(): Promise<FetchConfig> {
  const userKey = process.env.OPENAI_API_KEY;
  if (userKey || isDev) {
    return {
      url: 'https://api.openai.com/v1/embeddings',
      headers: userKey ? { 'Authorization': `Bearer ${userKey}` } : {},
    };
  }
  return {
    url: `${getProxyBase()}/openai/v1/embeddings`,
    headers: await getAuthHeader(),
  };
}

// ── Composio ──

export async function getComposioConfig(): Promise<{ apiKey: string | null; baseURL: string | null; headers?: Record<string, string> }> {
  const userKey = process.env.COMPOSIO_API_KEY;
  if (userKey || isDev) {
    return { apiKey: userKey || null, baseURL: null };
  }
  return {
    apiKey: 'proxied',
    baseURL: `${getProxyBase()}/composio`,
    headers: await getAuthHeader(),
  };
}

// ── Anthropic ──

export async function getAnthropicConfig(): Promise<LLMProxyConfig> {
  const userKey = getUserKey('anthropicKey');
  if (userKey) {
    return { apiKey: userKey };
  }
  return {
    apiKey: 'proxied',
    baseURL: `${getProxyBase()}/anthropic`,
    defaultHeaders: await getAuthHeader(),
  };
}

// ── Google ──

export async function getGoogleConfig(): Promise<LLMProxyConfig> {
  const userKey = getUserKey('googleKey');
  if (userKey) {
    return { apiKey: userKey };
  }
  return {
    apiKey: 'proxied',
    baseURL: `${getProxyBase()}/google`,
    defaultHeaders: await getAuthHeader(),
  };
}

// ── OpenAI (chat / computer use) ──

export async function getOpenAIConfig(): Promise<LLMProxyConfig> {
  const userKey = getUserKey('openaiKey');
  if (userKey) {
    return { apiKey: userKey };
  }
  return {
    apiKey: 'proxied',
    baseURL: `${getProxyBase()}/openai/v1`,
    defaultHeaders: await getAuthHeader(),
  };
}
