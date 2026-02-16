import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import type { MemoryIndexManager } from '../../services/memory/memory-index';

const MemorySearchSchema = z.object({
  query: z.string().describe('Semantic search query for memories'),
  maxResults: z.number().optional().describe('Maximum results to return (default 10)'),
});

/**
 * Create the memory_search tool for the LLM.
 * Searches long-term memory (MEMORY.md + daily logs) using hybrid vector + keyword search.
 */
export function createMemorySearchTool(manager: MemoryIndexManager): DynamicStructuredTool {
  return tool(
    async (input) => {
      const results = await manager.search(input.query, {
        maxResults: input.maxResults ?? 10,
        minScore: 0.3,
      });

      if (results.length === 0) {
        return JSON.stringify({ results: [], message: 'No relevant memories found.' });
      }

      return JSON.stringify({
        results: results.map((r) => ({
          path: r.path,
          startLine: r.startLine,
          endLine: r.endLine,
          score: r.score,
          snippet: r.snippet,
          citation: r.citation,
        })),
      });
    },
    {
      name: 'memory_search',
      description:
        'Search your long-term memory (MEMORY.md and daily logs) semantically. ' +
        'Use this to recall prior decisions, preferences, facts, or context from previous interactions. ' +
        'Returns relevant snippets with file paths and line numbers.',
      schema: MemorySearchSchema,
    },
  );
}

const MemoryGetSchema = z.object({
  path: z.string().describe('Relative path to memory file (e.g., "MEMORY.md" or "2026-02-16.md")'),
  from: z.number().optional().describe('Starting line number (1-indexed)'),
  lines: z.number().optional().describe('Number of lines to read'),
});

/**
 * Create the memory_get tool for the LLM.
 * Reads specific lines from a memory file after finding them with memory_search.
 */
export function createMemoryGetTool(manager: MemoryIndexManager): DynamicStructuredTool {
  return tool(
    async (input) => {
      const result = await manager.readFile({
        relPath: input.path,
        from: input.from,
        lines: input.lines,
      });
      return JSON.stringify(result);
    },
    {
      name: 'memory_get',
      description:
        'Read specific lines from a memory file. ' +
        'Use after memory_search to pull the full context around a snippet. ' +
        'Only reads .md files in the memory directory.',
      schema: MemoryGetSchema,
    },
  );
}
