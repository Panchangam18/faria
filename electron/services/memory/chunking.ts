import crypto from 'node:crypto';
import type { MemoryChunk } from './types';

/**
 * Hash a text string with SHA-256.
 * Ported from OpenClaw's internal.ts.
 */
export function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Split markdown content into overlapping chunks for embedding.
 * Ported from OpenClaw's internal.ts (chunkMarkdown).
 *
 * @param content  Raw markdown text
 * @param chunking Chunk size in tokens and overlap in tokens (tokens ≈ chars/4)
 */
export function chunkMarkdown(
  content: string,
  chunking: { tokens: number; overlap: number } = { tokens: 400, overlap: 80 },
): MemoryChunk[] {
  const lines = content.split('\n');
  if (lines.length === 0) return [];

  const maxChars = Math.max(32, chunking.tokens * 4);
  const overlapChars = Math.max(0, chunking.overlap * 4);
  const chunks: MemoryChunk[] = [];

  let current: Array<{ line: string; lineNo: number }> = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    const firstEntry = current[0];
    const lastEntry = current[current.length - 1];
    if (!firstEntry || !lastEntry) return;

    const text = current.map((entry) => entry.line).join('\n');
    chunks.push({
      startLine: firstEntry.lineNo,
      endLine: lastEntry.lineNo,
      text,
      hash: hashText(text),
    });
  };

  const carryOverlap = () => {
    if (overlapChars <= 0 || current.length === 0) {
      current = [];
      currentChars = 0;
      return;
    }
    let acc = 0;
    const kept: Array<{ line: string; lineNo: number }> = [];
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const entry = current[i];
      if (!entry) continue;
      acc += entry.line.length + 1;
      kept.unshift(entry);
      if (acc >= overlapChars) break;
    }
    current = kept;
    currentChars = kept.reduce((sum, entry) => sum + entry.line.length + 1, 0);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const lineNo = i + 1;

    // Split very long lines into segments
    const segments: string[] = [];
    if (line.length === 0) {
      segments.push('');
    } else {
      for (let start = 0; start < line.length; start += maxChars) {
        segments.push(line.slice(start, start + maxChars));
      }
    }

    for (const segment of segments) {
      const lineSize = segment.length + 1;
      if (currentChars + lineSize > maxChars && current.length > 0) {
        flush();
        carryOverlap();
      }
      current.push({ line: segment, lineNo });
      currentChars += lineSize;
    }
  }

  flush();
  return chunks;
}
