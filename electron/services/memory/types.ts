/**
 * A single memory stored in the system
 */
export interface Memory {
  id: string;
  content: string;
  embedding: number[];  // 384-dimensional vector from all-MiniLM-L6-v2
  createdAt: number;    // Unix timestamp
}

/**
 * The memory store structure (JSON file format)
 */
export interface MemoryStore {
  version: number;
  memories: Memory[];
}

/**
 * A message tracked by the context manager
 */
export interface ContextMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | object;
  tokenCount: number;
  timestamp: number;
}

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
