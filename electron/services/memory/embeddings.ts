import { app } from 'electron';
import { join } from 'path';
import type { EmbeddingProvider } from './types';
import { getOpenAIEmbeddingConfig } from '../proxy';

// ── EmbeddingGemma provider via node-llama-cpp ──

const GEMMA_MODEL_PATH =
  'hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf';

/**
 * Create an EmbeddingProvider using EmbeddingGemma-300M via node-llama-cpp.
 */
export function createGemmaEmbeddingProvider(): EmbeddingProvider {
  let ctx: any = null;
  let initPromise: Promise<any> | null = null;
  let failed = false;

  const ensureContext = async () => {
    if (ctx) return ctx;
    if (failed) throw new Error('node-llama-cpp not available');
    if (initPromise) return initPromise;

    initPromise = (async () => {
      const { getLlama, resolveModelFile, LlamaLogLevel } = await import('node-llama-cpp');
      const cacheDir = join(app.getPath('userData'), 'models', 'gguf');
      const llama = await getLlama({ logLevel: LlamaLogLevel.error });
      const resolved = await resolveModelFile(GEMMA_MODEL_PATH, cacheDir);
      const model = await llama.loadModel({ modelPath: resolved });
      ctx = await model.createEmbeddingContext();
      console.log('[Memory] EmbeddingGemma-300M ready via node-llama-cpp');
      return ctx;
    })();

    return initPromise;
  };

  return {
    model: 'embeddinggemma-300m',
    dimensions: 256,
    async embedQuery(text: string): Promise<number[]> {
      const context = await ensureContext();
      const embedding = await context.getEmbeddingFor(text);
      return sanitizeAndNormalize(Array.from(embedding.vector));
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      const context = await ensureContext();
      const results: number[][] = [];
      for (const text of texts) {
        const embedding = await context.getEmbeddingFor(text);
        results.push(sanitizeAndNormalize(Array.from(embedding.vector)));
      }
      return results;
    },
  };
}

// ── OpenAI embedding provider ──

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_EMBEDDING_DIMS = 1536;

/**
 * Create an EmbeddingProvider using OpenAI's text-embedding-3-small.
 * Requires OPENAI_API_KEY in .env.
 */
export function createOpenAIEmbeddingProvider(): EmbeddingProvider {
  const embed = async (texts: string[]): Promise<number[][]> => {
    const config = await getOpenAIEmbeddingConfig();
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        ...config.headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input: texts,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`OpenAI embedding API error ${response.status}: ${errBody}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => sanitizeAndNormalize(d.embedding));
  };

  return {
    model: OPENAI_EMBEDDING_MODEL,
    dimensions: OPENAI_EMBEDDING_DIMS,
    async embedQuery(text: string): Promise<number[]> {
      const [result] = await embed([text]);
      return result!;
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      return embed(texts);
    },
  };
}

// ── Shared utilities ──

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

let _defaultProvider: EmbeddingProvider | null = null;
function getDefaultProvider(): EmbeddingProvider {
  if (!_defaultProvider) _defaultProvider = createDefaultEmbeddingProvider();
  return _defaultProvider;
}

/** Convenience wrapper — embeds a single text using the default provider. */
export async function getEmbedding(text: string): Promise<number[]> {
  return getDefaultProvider().embedQuery(text);
}

/** No-op kept for backward compatibility — providers initialize lazily. */
export async function initEmbeddings(): Promise<void> {}

function sanitizeAndNormalize(vec: number[]): number[] {
  const sanitized = vec.map((v) => (Number.isFinite(v) ? v : 0));
  const magnitude = Math.sqrt(sanitized.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map((v) => v / magnitude);
}

// ── Default provider with fallback chain ──

/**
 * Create the default embedding provider for the memory system.
 *
 * Priority: OpenAI (fast, no RAM cost) → EmbeddingGemma (local, only if OpenAI unavailable).
 * Set FARIA_LOCAL_EMBEDDINGS=1 to force local Gemma regardless.
 */
export function createDefaultEmbeddingProvider(): EmbeddingProvider {
  const forceLocal = process.env.FARIA_LOCAL_EMBEDDINGS === '1';

  if (forceLocal) {
    console.log('[Memory] Using local EmbeddingGemma (FARIA_LOCAL_EMBEDDINGS=1)');
    return createGemmaEmbeddingProvider();
  }

  // Use OpenAI by default (batched, no RAM overhead); fall back to local Gemma
  // only if OpenAI is unavailable.
  const openai = createOpenAIEmbeddingProvider();
  let useGemma = false;
  let gemmaProvider: EmbeddingProvider | null = null;

  const getGemma = (): EmbeddingProvider => {
    if (!gemmaProvider) {
      console.warn('[Memory] Falling back to local EmbeddingGemma (OpenAI unavailable)');
      gemmaProvider = createGemmaEmbeddingProvider();
    }
    return gemmaProvider;
  };

  const withFallback = async <T>(fn: (p: EmbeddingProvider) => Promise<T>): Promise<T> => {
    if (!useGemma) {
      try {
        return await fn(openai);
      } catch (err) {
        console.warn('[Memory] OpenAI embedding failed, falling back to local Gemma:', err);
        useGemma = true;
      }
    }
    return fn(getGemma());
  };

  // Reflect active provider metadata accurately
  let _activeProvider: EmbeddingProvider = openai;
  const proxy: EmbeddingProvider = {
    get model() { return _activeProvider.model; },
    get dimensions() { return _activeProvider.dimensions; },
    async embedQuery(text: string): Promise<number[]> {
      const result = await withFallback((p) => p.embedQuery(text));
      if (useGemma) _activeProvider = getGemma();
      return result;
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      const result = await withFallback((p) => p.embedBatch(texts));
      if (useGemma) _activeProvider = getGemma();
      return result;
    },
  };

  return proxy;
}

/**
 * @deprecated Use createDefaultEmbeddingProvider() instead.
 */
export const createHFEmbeddingProvider = createDefaultEmbeddingProvider;
