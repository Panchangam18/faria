import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs/promises';

const MAX_BYTES = 512 * 1024; // 500KB
const DEFAULT_LINE_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

const ReadFileSchema = z.object({
  file_path: z.string().describe('Absolute path to the file to read'),
  offset: z.number().optional().describe('Line number to start reading from (1-based). Defaults to 1.'),
  limit: z.number().optional().describe('Number of lines to read. Defaults to 2000.'),
});

export function createReadFileTool(): DynamicStructuredTool {
  return tool(
    async (input) => {
      const { file_path, offset = 1, limit = DEFAULT_LINE_LIMIT } = input;

      try {
        const raw = await fs.readFile(file_path, 'utf-8');

        if (raw.length === 0) {
          return `File ${file_path} is empty.`;
        }

        const allLines = raw.split('\n');
        const startIdx = Math.max(0, offset - 1);
        const sliced = allLines.slice(startIdx, startIdx + limit);

        // Build output with line numbers, respecting byte limit
        let output = '';
        const lineNumWidth = String(startIdx + sliced.length).length;

        for (let i = 0; i < sliced.length; i++) {
          const lineNum = String(startIdx + i + 1).padStart(lineNumWidth, ' ');
          let line = sliced[i];
          if (line.length > MAX_LINE_LENGTH) {
            line = line.slice(0, MAX_LINE_LENGTH) + '... (truncated)';
          }
          const formatted = `${lineNum}\t${line}\n`;

          if (output.length + formatted.length > MAX_BYTES) {
            output += `\n... (output truncated at ${MAX_BYTES} bytes)`;
            break;
          }
          output += formatted;
        }

        if (startIdx + limit < allLines.length) {
          output += `\n(${allLines.length - startIdx - limit} more lines. Use offset=${startIdx + limit + 1} to continue.)`;
        }

        return output;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('ENOENT')) {
          return `Error: File not found: ${file_path}`;
        }
        if (msg.includes('EISDIR')) {
          return `Error: ${file_path} is a directory, not a file.`;
        }
        return `Error reading file: ${msg}`;
      }
    },
    {
      name: 'read_file',
      description: 'Read the contents of a file. Returns content with line numbers. Supports offset/limit for large files.',
      schema: ReadFileSchema,
    }
  );
}
