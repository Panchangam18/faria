import type Database from 'better-sqlite3';
import { watch, type FSWatcher } from 'chokidar';
import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { EmbeddingProvider, MemoryFileEntry, MemorySearchResult } from './types';
import { chunkMarkdown, hashText } from './chunking';
import {
  buildFtsQuery,
  bm25RankToScore,
  mergeHybridResults,
  cosineSimilarityVec,
  type HybridVectorResult,
  type HybridKeywordResult,
} from './hybrid-search';

const CHUNKING = { tokens: 400, overlap: 80 };
const VECTOR_WEIGHT = 0.7;
const TEXT_WEIGHT = 0.3;
const CANDIDATE_MULTIPLIER = 4;
const MAX_SNIPPET_CHARS = 700;

let singleton: MemoryIndexManager | null = null;

/**
 * Get the memory root directory (~/.config/Faria/memory/).
 */
export function getMemoryRoot(): string {
  const dir = path.join(app.getPath('userData'), 'memory');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get or create the singleton MemoryIndexManager.
 */
export function getOrCreateMemoryIndexManager(
  db: Database.Database,
  provider: EmbeddingProvider,
): MemoryIndexManager {
  if (!singleton) {
    singleton = new MemoryIndexManager(db, provider);
  }
  return singleton;
}

/**
 * Core memory index manager.
 * Syncs markdown files into SQLite with chunked embeddings,
 * provides hybrid (vector + FTS5) search.
 */
export class MemoryIndexManager {
  private db: Database.Database;
  private provider: EmbeddingProvider;
  private dirty = true;
  private syncing: Promise<void> | null = null;
  private watcher: FSWatcher | null = null;
  private ftsAvailable: boolean;

  constructor(db: Database.Database, provider: EmbeddingProvider) {
    this.db = db;
    this.provider = provider;

    // Check if FTS table exists
    const ftsCheck = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_chunks_fts'")
      .get();
    this.ftsAvailable = !!ftsCheck;

    this.ensureWatcher();
    console.log('[MemoryIndex] Initialized (FTS:', this.ftsAvailable, ')');
  }

  /**
   * Search memory using hybrid vector + keyword search.
   */
  async search(
    query: string,
    opts?: { maxResults?: number; minScore?: number },
  ): Promise<MemorySearchResult[]> {
    const maxResults = opts?.maxResults ?? 10;
    const minScore = opts?.minScore ?? 0.3;

    // Sync if dirty
    if (this.dirty) {
      await this.sync();
    }

    const candidateLimit = maxResults * CANDIDATE_MULTIPLIER;

    // Vector search
    const queryVec = await this.provider.embedQuery(query);
    const vectorResults = this.searchVector(queryVec, candidateLimit);

    // Keyword search (FTS5)
    const keywordResults = this.ftsAvailable ? this.searchKeyword(query, candidateLimit) : [];

    // Merge
    const merged = mergeHybridResults({
      vector: vectorResults,
      keyword: keywordResults,
      vectorWeight: VECTOR_WEIGHT,
      textWeight: TEXT_WEIGHT,
    });

    return merged
      .filter((r) => r.score >= minScore)
      .slice(0, maxResults)
      .map((r) => ({
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        score: r.score,
        snippet: r.snippet.slice(0, MAX_SNIPPET_CHARS),
        citation: `${r.path}#L${r.startLine}-L${r.endLine}`,
      }));
  }

  /**
   * Read a specific region of a memory file.
   */
  async readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }> {
    const memoryRoot = getMemoryRoot();
    const normalized = params.relPath.replace(/^[./]+/, '').replace(/\\/g, '/');

    // Security: only allow reads from memory directory
    if (!normalized.endsWith('.md')) {
      throw new Error('Only .md files can be read');
    }

    const absPath = path.join(memoryRoot, normalized);
    const resolved = path.resolve(absPath);
    if (!resolved.startsWith(path.resolve(memoryRoot))) {
      throw new Error('Path traversal not allowed');
    }

    if (!existsSync(absPath)) {
      throw new Error(`File not found: ${normalized}`);
    }

    const content = readFileSync(absPath, 'utf-8');
    const lines = content.split('\n');

    if (params.from !== undefined) {
      const startIdx = Math.max(0, params.from - 1); // 1-indexed to 0-indexed
      const count = params.lines ?? 50;
      const slice = lines.slice(startIdx, startIdx + count);
      return { text: slice.join('\n'), path: normalized };
    }

    return { text: content, path: normalized };
  }

  /**
   * Sync memory files into the index.
   */
  async sync(opts?: { force?: boolean }): Promise<void> {
    if (this.syncing) return this.syncing;

    this.syncing = this._doSync(opts?.force ?? false).finally(() => {
      this.syncing = null;
      this.dirty = false;
    });

    return this.syncing;
  }

  /**
   * Clean up watcher and resources.
   */
  close(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    singleton = null;
  }

  // ── Private ──

  private searchVector(queryVec: number[], limit: number): HybridVectorResult[] {
    const rows = this.db
      .prepare('SELECT id, path, start_line, end_line, text, embedding FROM memory_chunks')
      .all() as Array<{
      id: string;
      path: string;
      start_line: number;
      end_line: number;
      text: string;
      embedding: string;
    }>;

    const scored = rows
      .map((row) => {
        const emb = parseEmbedding(row.embedding);
        const score = cosineSimilarityVec(queryVec, emb);
        return {
          id: row.id,
          path: row.path,
          startLine: row.start_line,
          endLine: row.end_line,
          snippet: row.text,
          vectorScore: score,
        };
      })
      .sort((a, b) => b.vectorScore - a.vectorScore);

    return scored.slice(0, limit);
  }

  private searchKeyword(query: string, limit: number): HybridKeywordResult[] {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) return [];

    try {
      const rows = this.db
        .prepare(
          `SELECT id, path, start_line, end_line, text, rank
           FROM memory_chunks_fts
           WHERE memory_chunks_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(ftsQuery, limit) as Array<{
        id: string;
        path: string;
        start_line: number;
        end_line: number;
        text: string;
        rank: number;
      }>;

      return rows.map((row) => ({
        id: row.id,
        path: row.path,
        startLine: row.start_line,
        endLine: row.end_line,
        snippet: row.text,
        textScore: bm25RankToScore(row.rank),
      }));
    } catch (err) {
      console.warn('[MemoryIndex] FTS search failed:', err);
      return [];
    }
  }

  private async _doSync(force: boolean): Promise<void> {
    const memoryRoot = getMemoryRoot();
    const files = await this.listMemoryFiles(memoryRoot);
    console.log(`[MemoryIndex] Syncing ${files.length} files...`);

    // Build current file entries
    const entries: MemoryFileEntry[] = [];
    for (const absPath of files) {
      try {
        const stat = await fs.stat(absPath);
        const content = await fs.readFile(absPath, 'utf-8');
        entries.push({
          path: path.relative(memoryRoot, absPath).replace(/\\/g, '/'),
          absPath,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          hash: hashText(content),
        });
      } catch {
        // File may have been deleted between listing and reading
      }
    }

    // Check which files need re-indexing
    for (const entry of entries) {
      const existing = this.db
        .prepare('SELECT hash FROM memory_files WHERE path = ?')
        .get(entry.path) as { hash: string } | undefined;

      if (!force && existing?.hash === entry.hash) continue;

      await this.indexFile(entry);
    }

    // Remove chunks for files that no longer exist
    const indexedPaths = (
      this.db.prepare('SELECT path FROM memory_files').all() as Array<{ path: string }>
    ).map((r) => r.path);
    const currentPaths = new Set(entries.map((e) => e.path));

    for (const indexed of indexedPaths) {
      if (!currentPaths.has(indexed)) {
        this.removeFile(indexed);
      }
    }
  }

  private async indexFile(entry: MemoryFileEntry): Promise<void> {
    console.log(`[MemoryIndex] Indexing ${entry.path}...`);
    const content = await fs.readFile(entry.absPath, 'utf-8');
    const chunks = chunkMarkdown(content, CHUNKING);

    // Remove old chunks for this file
    this.removeFile(entry.path);

    // Embed and insert chunks
    const textsToEmbed: string[] = [];
    const chunkData: Array<{ id: string; startLine: number; endLine: number; text: string; hash: string }> = [];

    for (const chunk of chunks) {
      // Check embedding cache
      const cached = this.db
        .prepare('SELECT embedding FROM memory_embedding_cache WHERE hash = ?')
        .get(chunk.hash) as { embedding: string } | undefined;

      if (cached) {
        const id = uuidv4();
        this.insertChunk(id, entry.path, chunk.startLine, chunk.endLine, chunk.hash, chunk.text, cached.embedding);
        continue;
      }

      chunkData.push({
        id: uuidv4(),
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        hash: chunk.hash,
      });
      textsToEmbed.push(chunk.text);
    }

    // Batch embed uncached chunks
    if (textsToEmbed.length > 0) {
      const embeddings = await this.provider.embedBatch(textsToEmbed);

      for (let i = 0; i < chunkData.length; i++) {
        const chunk = chunkData[i]!;
        const embedding = embeddings[i]!;
        const embeddingJson = JSON.stringify(embedding);

        this.insertChunk(chunk.id, entry.path, chunk.startLine, chunk.endLine, chunk.hash, chunk.text, embeddingJson);

        // Cache the embedding
        this.db
          .prepare(
            `INSERT OR REPLACE INTO memory_embedding_cache (hash, embedding, dims, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(chunk.hash, embeddingJson, embedding.length, Date.now());
      }
    }

    // Update file record
    this.db
      .prepare(
        `INSERT OR REPLACE INTO memory_files (path, hash, mtime, size)
         VALUES (?, ?, ?, ?)`,
      )
      .run(entry.path, entry.hash, Math.floor(entry.mtimeMs), entry.size);

    console.log(`[MemoryIndex] Indexed ${entry.path}: ${chunks.length} chunks`);
  }

  private insertChunk(
    id: string,
    filePath: string,
    startLine: number,
    endLine: number,
    hash: string,
    text: string,
    embeddingJson: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO memory_chunks (id, path, start_line, end_line, hash, model, text, embedding, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, filePath, startLine, endLine, hash, this.provider.model, text, embeddingJson, Date.now());

    if (this.ftsAvailable) {
      try {
        this.db
          .prepare(
            `INSERT INTO memory_chunks_fts (id, path, model, start_line, end_line, text)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(id, filePath, this.provider.model, startLine, endLine, text);
      } catch {
        // FTS insert failed — non-fatal
      }
    }
  }

  private removeFile(filePath: string): void {
    // Get chunk IDs to remove from FTS
    if (this.ftsAvailable) {
      const chunkIds = (
        this.db.prepare('SELECT id FROM memory_chunks WHERE path = ?').all(filePath) as Array<{ id: string }>
      ).map((r) => r.id);

      for (const id of chunkIds) {
        try {
          this.db.prepare('DELETE FROM memory_chunks_fts WHERE id = ?').run(id);
        } catch {
          // FTS delete failed — non-fatal
        }
      }
    }

    this.db.prepare('DELETE FROM memory_chunks WHERE path = ?').run(filePath);
    this.db.prepare('DELETE FROM memory_files WHERE path = ?').run(filePath);
  }

  private async listMemoryFiles(memoryRoot: string): Promise<string[]> {
    const result: string[] = [];

    // Check for MEMORY.md
    const memoryFile = path.join(memoryRoot, 'MEMORY.md');
    if (existsSync(memoryFile)) result.push(memoryFile);

    // Walk memory directory for *.md files
    try {
      const entries = await fs.readdir(memoryRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md') {
          result.push(path.join(memoryRoot, entry.name));
        }
      }
    } catch {
      // Directory might not exist yet
    }

    return result;
  }

  private ensureWatcher(): void {
    if (this.watcher) return;
    const memoryRoot = getMemoryRoot();

    this.watcher = watch(memoryRoot, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 1000 },
    });

    const markDirty = () => {
      this.dirty = true;
    };

    this.watcher.on('add', markDirty);
    this.watcher.on('change', markDirty);
    this.watcher.on('unlink', markDirty);
  }
}

function parseEmbedding(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as number[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
