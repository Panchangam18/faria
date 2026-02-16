/**
 * Hybrid search utilities — combines vector (semantic) and BM25 (keyword) results.
 * Ported from OpenClaw's hybrid.ts.
 */

export interface HybridVectorResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  vectorScore: number;
}

export interface HybridKeywordResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  textScore: number;
}

/**
 * Build an FTS5 MATCH query from a raw search string.
 * Tokenizes into quoted terms joined by AND.
 * Returns null if no usable tokens.
 */
export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  if (tokens.length === 0) return null;
  const quoted = tokens.map((t) => `"${t.replace(/"/g, '')}"`);
  return quoted.join(' AND ');
}

/**
 * Convert a BM25 rank value (lower = better match) to a 0-1 score.
 */
export function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

/**
 * Merge vector and keyword search results with weighted scoring.
 * Default weights: vector 0.7, text 0.3.
 */
export function mergeHybridResults(params: {
  vector: HybridVectorResult[];
  keyword: HybridKeywordResult[];
  vectorWeight: number;
  textWeight: number;
}): Array<{
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}> {
  const byId = new Map<
    string,
    {
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      snippet: string;
      vectorScore: number;
      textScore: number;
    }
  >();

  for (const r of params.vector) {
    byId.set(r.id, {
      id: r.id,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      snippet: r.snippet,
      vectorScore: r.vectorScore,
      textScore: 0,
    });
  }

  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.textScore = r.textScore;
      if (r.snippet && r.snippet.length > 0) {
        existing.snippet = r.snippet;
      }
    } else {
      byId.set(r.id, {
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        snippet: r.snippet,
        vectorScore: 0,
        textScore: r.textScore,
      });
    }
  }

  const merged = Array.from(byId.values()).map((entry) => {
    const score = params.vectorWeight * entry.vectorScore + params.textWeight * entry.textScore;
    return {
      id: entry.id,
      path: entry.path,
      startLine: entry.startLine,
      endLine: entry.endLine,
      score,
      snippet: entry.snippet,
    };
  });

  return merged.sort((a, b) => b.score - a.score);
}

/**
 * Cosine similarity between two vectors.
 * Handles zero-length and zero-norm vectors gracefully.
 */
export function cosineSimilarityVec(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
