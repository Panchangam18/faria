import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { initDatabase } from '../../db/sqlite';
import type { MemoryStore } from './types';

/**
 * One-time migration from memories.json (v1) to markdown files (v2).
 *
 * 1. Reads all memories from memories.json
 * 2. Writes them to MEMORY.md as a bullet list
 * 3. Marks migration complete in settings table
 * 4. Renames memories.json → memories.json.bak
 */
export async function migrateToMarkdownMemory(): Promise<void> {
  const db = initDatabase();

  // Check if already migrated
  const done = db
    .prepare("SELECT value FROM settings WHERE key = 'memory_v2_migrated'")
    .get() as { value: string } | undefined;

  if (done?.value === 'true') {
    console.log('[Migration] Memory v2 migration already complete');
    return;
  }

  const dataDir = join(app.getPath('userData'), 'data');
  const memoriesPath = join(dataDir, 'memories.json');

  if (!existsSync(memoriesPath)) {
    console.log('[Migration] No memories.json to migrate');
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('memory_v2_migrated', 'true')").run();
    return;
  }

  console.log('[Migration] Migrating memories.json → MEMORY.md...');

  try {
    const raw = readFileSync(memoriesPath, 'utf-8');
    const store: MemoryStore = JSON.parse(raw);

    if (!store.memories || store.memories.length === 0) {
      console.log('[Migration] No memories to migrate');
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('memory_v2_migrated', 'true')").run();
      return;
    }

    // Ensure memory directory exists
    const memoryRoot = join(app.getPath('userData'), 'memory');
    if (!existsSync(memoryRoot)) mkdirSync(memoryRoot, { recursive: true });

    // Write memories to MEMORY.md
    const memoryFile = join(memoryRoot, 'MEMORY.md');
    const lines = ['# Faria Memory', '', '## Migrated from v1', ''];
    for (const memory of store.memories) {
      lines.push(`- ${memory.content}`);
    }
    lines.push('');

    writeFileSync(memoryFile, lines.join('\n'));
    console.log(`[Migration] Wrote ${store.memories.length} memories to MEMORY.md`);

    // Backup old file
    renameSync(memoriesPath, memoriesPath + '.bak');
    console.log('[Migration] Renamed memories.json → memories.json.bak');

    // Mark complete
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('memory_v2_migrated', 'true')").run();
    console.log('[Migration] Memory v2 migration complete');
  } catch (error) {
    console.error('[Migration] Memory v2 migration failed:', error);
    // Don't mark as complete so it retries next startup
  }
}
