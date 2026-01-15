import { TextEdit } from '../../services/text-extraction';
import { ToolExecutionResult } from './types';
import { executeWebSearch } from './web-search';
import { executeMakeEdit } from './make-edit';
import { executeInsertImage } from './insert-image';
import { executeAnswer } from './answer';

export { INLINE_TOOLS, INLINE_TOOLS_GOOGLE } from './definitions';
export type { InlineResult, ToolExecutionResult } from './types';

/**
 * Execute a tool by name
 */
export async function executeTool(
  name: string,
  input: unknown,
  targetApp: string | null,
  contextText: string | null,
  sendStatus: (status: string) => void
): Promise<ToolExecutionResult> {
  const params = input as Record<string, unknown>;
  
  switch (name) {
    case 'web_search': {
      const query = params.query as string;
      return await executeWebSearch(query, sendStatus);
    }
    
    case 'make_edit': {
      const edits = params.edits as TextEdit[];
      return await executeMakeEdit(edits, targetApp, sendStatus);
    }
    
    case 'insert_image': {
      const query = params.query as string;
      return await executeInsertImage(query, targetApp, sendStatus);
    }
    
    case 'answer': {
      const text = params.text as string;
      return executeAnswer(text);
    }
    
    default:
      return {
        output: `Unknown tool: ${name}`,
        terminal: false,
        result: { type: 'error', content: `Unknown tool: ${name}` }
      };
  }
}

