import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

const WriteFileSchema = z.object({
  file_path: z.string().describe('Absolute path to the file to write'),
  content: z.string().describe('The content to write to the file'),
});

export function createWriteFileTool(): DynamicStructuredTool {
  return tool(
    async (input) => {
      const { file_path, content } = input;

      try {
        await fs.mkdir(path.dirname(file_path), { recursive: true });
        await fs.writeFile(file_path, content, 'utf-8');
        const bytes = Buffer.byteLength(content, 'utf-8');
        return `Successfully wrote ${bytes} bytes to ${file_path}`;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error writing file: ${msg}`;
      }
    },
    {
      name: 'write_file',
      description: 'Create or overwrite a file with the given content. Creates parent directories if needed.',
      schema: WriteFileSchema,
    }
  );
}
