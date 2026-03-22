import { app } from 'electron';
import { initDatabase } from '../db/sqlite';

const PROXY_BASE = 'https://faria-proxy.madhavan.workers.dev';
const FARIA_APP_TOKEN = 'faria_app_c0ce4112df5d980a65e92868ba7f5e65';

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

// ── Serper ──

export function getSerperConfig(path: string = '/search'): FetchConfig {
  const userKey = process.env.SERPER_API_KEY;
  if (userKey || isDev) {
    return {
      url: `https://google.serper.dev${path}`,
      headers: userKey ? { 'X-API-KEY': userKey } : {},
    };
  }
  return {
    url: `${PROXY_BASE}/serper${path}`,
    headers: { 'X-Faria-Token': FARIA_APP_TOKEN },
  };
}

// ── OpenAI Embeddings ──

export function getOpenAIEmbeddingConfig(): FetchConfig {
  const userKey = process.env.OPENAI_API_KEY;
  if (userKey || isDev) {
    return {
      url: 'https://api.openai.com/v1/embeddings',
      headers: userKey ? { 'Authorization': `Bearer ${userKey}` } : {},
    };
  }
  return {
    url: `${PROXY_BASE}/openai/v1/embeddings`,
    headers: { 'X-Faria-Token': FARIA_APP_TOKEN },
  };
}

// ── Composio ──

export function getComposioConfig(): { apiKey: string | null; baseURL: string | null; headers?: Record<string, string> } {
  const userKey = process.env.COMPOSIO_API_KEY;
  if (userKey || isDev) {
    return { apiKey: userKey || null, baseURL: null };
  }
  return {
    apiKey: 'proxied',
    baseURL: `${PROXY_BASE}/composio`,
    headers: { 'X-Faria-Token': FARIA_APP_TOKEN },
  };
}

// ── Anthropic ──

export function getAnthropicConfig(): LLMProxyConfig {
  const userKey = getUserKey('anthropicKey');
  if (userKey) {
    return { apiKey: userKey };
  }
  return {
    apiKey: 'proxied',
    baseURL: `${PROXY_BASE}/anthropic`,
    defaultHeaders: { 'X-Faria-Token': FARIA_APP_TOKEN },
  };
}

// ── Google ──

export function getGoogleConfig(): LLMProxyConfig {
  const userKey = getUserKey('googleKey');
  if (userKey) {
    return { apiKey: userKey };
  }
  return {
    apiKey: 'proxied',
    baseURL: `${PROXY_BASE}/google`,
    defaultHeaders: { 'X-Faria-Token': FARIA_APP_TOKEN },
  };
}

// ── OpenAI (chat / computer use) ──

export function getOpenAIConfig(): LLMProxyConfig {
  const userKey = getUserKey('openaiKey');
  if (userKey) {
    return { apiKey: userKey };
  }
  return {
    apiKey: 'proxied',
    baseURL: `${PROXY_BASE}/openai/v1`,
    defaultHeaders: { 'X-Faria-Token': FARIA_APP_TOKEN },
  };
}
