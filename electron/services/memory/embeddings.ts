import { app } from 'electron';
import { join } from 'path';
import type { EmbeddingProvider } from './types';

// ── Legacy HuggingFace embedder (kept for backward compatibility) ──

// Lazy-loaded embedder
let embedder: any = null;
let loadingPromise: Promise<void> | null = null;

/**
 * Initialize the HuggingFace embedding model (lazy load on first use)
 * Uses Xenova/all-MiniLM-L6-v2 - a small, fast model producing 384-dim vectors
 */
export async function initEmbeddings(): Promise<void> {
  if (embedder) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    console.log('[Memory] Loading HF embedding model...');

    // Dynamic import to avoid bundling issues
    const { pipeline, env } = await import('@huggingface/transformers');

    // Configure cache directory for Electron
    env.cacheDir = join(app.getPath('userData'), 'models');
    env.allowLocalModels = true;

    embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { dtype: 'q8' }  // Quantized for faster inference
    );

    console.log('[Memory] HF embedding model ready');
  })();

  return loadingPromise;
}

/**
 * Get the embedding vector for a text string using HuggingFace model
 * Returns a 384-dimensional normalized vector
 */
export async function getEmbedding(text: string): Promise<number[]> {
  await initEmbeddings();

  const output = await embedder(text, {
    pooling: 'mean',
    normalize: true
  });

  return Array.from(output.data);
}

/**
 * Calculate cosine similarity between two embedding vectors
 * Vectors are assumed to be pre-normalized, so dot product = cosine similarity
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return dotProduct;
}

// ── Shared utilities ──

function sanitizeAndNormalize(vec: number[]): number[] {
  const sanitized = vec.map((v) => (Number.isFinite(v) ? v : 0));
  const magnitude = Math.sqrt(sanitized.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map((v) => v / magnitude);
}

// ── EmbeddingGemma provider via node-llama-cpp ──

const GEMMA_MODEL_PATH =
  'hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf';

/**
 * Create an EmbeddingProvider using EmbeddingGemma-300M via node-llama-cpp.
 * Same model OpenClaw uses.
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set in .env');

  const embed = async (texts: string[]): Promise<number[][]> => {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
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

    // Sort by index to maintain input order
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

// ── Default provider with fallback chain ──

type FallbackLevel = 'gemma' | 'openai' | 'hf';

/**
 * Create the default embedding provider for the memory system.
 * Fallback chain: EmbeddingGemma (local) → OpenAI text-embedding-3-small → HF MiniLM (local)
 */
export function createDefaultEmbeddingProvider(): EmbeddingProvider {
  const gemma = createGemmaEmbeddingProvider();
  let fallback: FallbackLevel = 'gemma';
  let openaiProvider: EmbeddingProvider | null = null;

  const getOpenAI = (): EmbeddingProvider | null => {
    if (openaiProvider) return openaiProvider;
    try {
      openaiProvider = createOpenAIEmbeddingProvider();
      console.log('[Memory] OpenAI embeddings available as fallback');
      return openaiProvider;
    } catch {
      console.warn('[Memory] OpenAI embeddings not available (no API key)');
      return null;
    }
  };

  const embedWithFallback = async (fn: (provider: EmbeddingProvider) => Promise<number[]>): Promise<number[]> => {
    // Try Gemma
    if (fallback === 'gemma') {
      try {
        return await fn(gemma);
      } catch (err) {
        console.warn('[Memory] EmbeddingGemma failed, trying OpenAI:', err);
        fallback = 'openai';
      }
    }

    // Try OpenAI
    if (fallback === 'openai') {
      const openai = getOpenAI();
      if (openai) {
        try {
          return await fn(openai);
        } catch (err) {
          console.warn('[Memory] OpenAI embeddings failed, falling back to HF MiniLM:', err);
          fallback = 'hf';
        }
      } else {
        fallback = 'hf';
      }
    }

    // Final fallback: HuggingFace
    await initEmbeddings();
    return fn({
      model: 'all-MiniLM-L6-v2',
      dimensions: 384,
      embedQuery: getEmbedding,
      async embedBatch(texts: string[]): Promise<number[][]> {
        const results: number[][] = [];
        for (const t of texts) results.push(await getEmbedding(t));
        return results;
      },
    });
  };

  const embedBatchWithFallback = async (fn: (provider: EmbeddingProvider) => Promise<number[][]>): Promise<number[][]> => {
    if (fallback === 'gemma') {
      try {
        return await fn(gemma);
      } catch (err) {
        console.warn('[Memory] EmbeddingGemma batch failed, trying OpenAI:', err);
        fallback = 'openai';
      }
    }

    if (fallback === 'openai') {
      const openai = getOpenAI();
      if (openai) {
        try {
          return await fn(openai);
        } catch (err) {
          console.warn('[Memory] OpenAI batch failed, falling back to HF MiniLM:', err);
          fallback = 'hf';
        }
      } else {
        fallback = 'hf';
      }
    }

    await initEmbeddings();
    return fn({
      model: 'all-MiniLM-L6-v2',
      dimensions: 384,
      embedQuery: getEmbedding,
      async embedBatch(texts: string[]): Promise<number[][]> {
        const results: number[][] = [];
        for (const t of texts) results.push(await getEmbedding(t));
        return results;
      },
    });
  };

  return {
    model: gemma.model,
    dimensions: gemma.dimensions,
    async embedQuery(text: string): Promise<number[]> {
      return embedWithFallback((p) => p.embedQuery(text));
    },
    async embedBatch(texts: string[]): Promise<number[][]> {
      return embedBatchWithFallback((p) => p.embedBatch(texts));
    },
  };
}

/**
 * Create an EmbeddingProvider that wraps the local HuggingFace model.
 * @deprecated Use createDefaultEmbeddingProvider() instead.
 */
export function createHFEmbeddingProvider(): EmbeddingProvider {
  return createDefaultEmbeddingProvider();
}
