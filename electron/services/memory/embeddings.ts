import { app } from 'electron';
import { join } from 'path';

// Lazy-loaded embedder
let embedder: any = null;
let loadingPromise: Promise<void> | null = null;

/**
 * Initialize the embedding model (lazy load on first use)
 * Uses Xenova/all-MiniLM-L6-v2 - a small, fast model producing 384-dim vectors
 */
export async function initEmbeddings(): Promise<void> {
  if (embedder) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    console.log('[Memory] Loading embedding model...');

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

    console.log('[Memory] Embedding model ready');
  })();

  return loadingPromise;
}

/**
 * Get the embedding vector for a text string
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
