import { app } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { Memory, MemoryStore } from './types';
import { getEmbedding, cosineSimilarity } from './embeddings';

const MEMORIES_FILE = 'memories.json';
const CURRENT_VERSION = 1;

let store: MemoryStore | null = null;

function getMemoriesPath(): string {
  const dataDir = join(app.getPath('userData'), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  return join(dataDir, MEMORIES_FILE);
}

/**
 * Load memories from disk (cached in memory after first load)
 */
export function loadMemories(): MemoryStore {
  if (store) return store;

  const path = getMemoriesPath();
  if (existsSync(path)) {
    try {
      const data = readFileSync(path, 'utf-8');
      store = JSON.parse(data) as MemoryStore;
    } catch (e) {
      console.error('[Memory] Failed to load memories:', e);
      store = { version: CURRENT_VERSION, memories: [] };
    }
  } else {
    store = { version: CURRENT_VERSION, memories: [] };
  }

  return store!;
}

/**
 * Save memories to disk
 */
export function saveMemories(): void {
  if (!store) return;
  const path = getMemoriesPath();
  writeFileSync(path, JSON.stringify(store, null, 2));
}

/**
 * Add a new memory with auto-generated embedding
 */
export async function addMemory(content: string, source?: 'agent' | 'inline'): Promise<Memory> {
  loadMemories();

  const embedding = await getEmbedding(content);
  const now = Date.now();

  const memory: Memory = {
    id: uuidv4(),
    content,
    embedding,
    createdAt: now,
    source
  };

  store!.memories.push(memory);
  saveMemories();

  return memory;
}

/**
 * Delete a memory by ID
 */
export function deleteMemory(id: string): boolean {
  loadMemories();
  const index = store!.memories.findIndex(m => m.id === id);
  if (index >= 0) {
    store!.memories.splice(index, 1);
    saveMemories();
    return true;
  }
  return false;
}

/**
 * Search memories by semantic similarity to a query
 * Returns top N most relevant memories
 */
export async function searchMemories(query: string, limit: number = 7): Promise<Memory[]> {
  loadMemories();
  if (store!.memories.length === 0) return [];

  const queryEmbedding = await getEmbedding(query);

  const scored = store!.memories.map(memory => ({
    memory,
    score: cosineSimilarity(queryEmbedding, memory.embedding)
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.memory);
}

/**
 * Get all memories (for memory agent)
 */
export function getAllMemories(): Memory[] {
  loadMemories();
  return store!.memories;
}

/**
 * Clear in-memory cache (useful for testing)
 */
export function clearCache(): void {
  store = null;
}

/**
 * Migrate memories from old SQLite agent_memory table to new JSON format
 * This runs once on startup if migration hasn't been done
 */
export async function migrateFromSQLite(): Promise<void> {
  // Dynamic import to avoid circular dependency
  const { initDatabase } = await import('../../db/sqlite');
  const db = initDatabase();

  // Check if migration already done
  const migrationDone = db.prepare(
    "SELECT value FROM settings WHERE key = 'memory_migrated'"
  ).get() as { value: string } | undefined;

  if (migrationDone?.value === 'true') {
    console.log('[Memory] Migration already complete');
    return;
  }

  // Check if old agent_memory table exists
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_memory'"
  ).get();

  if (!tableExists) {
    console.log('[Memory] No old agent_memory table to migrate');
    // Mark migration as done anyway
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('memory_migrated', 'true')").run();
    return;
  }

  console.log('[Memory] Migrating from SQLite...');

  // Get old memories
  const oldMemories = db.prepare(
    'SELECT content FROM agent_memory ORDER BY created_at DESC LIMIT 100'
  ).all() as { content: string }[];

  if (oldMemories.length === 0) {
    console.log('[Memory] No old memories to migrate');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('memory_migrated', 'true')").run();
    return;
  }

  // Migrate each memory (this will generate embeddings)
  let migrated = 0;
  for (const old of oldMemories) {
    try {
      await addMemory(old.content);
      migrated++;
    } catch (e) {
      console.error('[Memory] Failed to migrate memory:', e);
    }
  }

  // Mark migration complete
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('memory_migrated', 'true')").run();

  console.log(`[Memory] Migrated ${migrated}/${oldMemories.length} memories`);
}
