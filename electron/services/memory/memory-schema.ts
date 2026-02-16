import type Database from 'better-sqlite3';

/**
 * Create memory index tables in the existing faria.db.
 * Adapted from OpenClaw's memory-schema.ts for better-sqlite3.
 */
export function ensureMemorySchema(db: Database.Database): { ftsAvailable: boolean; ftsError?: string } {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_files (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      hash TEXT NOT NULL,
      model TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_chunks_path ON memory_chunks(path);`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_embedding_cache (
      hash TEXT PRIMARY KEY,
      embedding TEXT NOT NULL,
      dims INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_memory_cache_updated ON memory_embedding_cache(updated_at);`);

  // FTS5 for keyword search — gracefully degrade if unavailable
  let ftsAvailable = false;
  let ftsError: string | undefined;
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
        text,
        id UNINDEXED,
        path UNINDEXED,
        model UNINDEXED,
        start_line UNINDEXED,
        end_line UNINDEXED
      );
    `);
    ftsAvailable = true;
  } catch (err) {
    ftsError = err instanceof Error ? err.message : String(err);
    ftsAvailable = false;
  }

  return { ftsAvailable, ...(ftsError ? { ftsError } : {}) };
}
