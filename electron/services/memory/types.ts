// ── Legacy types (kept for migration compatibility) ──

/**
 * A single memory stored in the system (legacy JSON format)
 */
export interface Memory {
  id: string;
  content: string;
  embedding: number[];  // 384-dimensional vector from all-MiniLM-L6-v2
  createdAt: number;    // Unix timestamp
}

/**
 * The memory store structure (legacy JSON file format)
 */
export interface MemoryStore {
  version: number;
  memories: Memory[];
}

// ── Context manager types ──

/**
 * A message tracked by the context manager
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | object;
  tokenCount: number;
  timestamp: number;
}

// ── Legacy memory agent types (kept for migration) ──

/**
 * Input to the background memory agent
 */
export interface MemoryAgentInput {
  query: string;
  response: string;
  memories: Memory[];
  toolsUsed?: string[];
}

/**
 * Output from the background memory agent
 */
export interface MemoryAgentOutput {
  newMemories: string[];
  deleteMemoryIds: string[];
}

// ── New memory index types (v2) ──

export interface MemorySearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  citation: string;
}

export interface MemoryChunk {
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
}

export interface MemoryFileEntry {
  path: string;       // relative to memory root
  absPath: string;
  mtimeMs: number;
  size: number;
  hash: string;
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embedQuery(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
