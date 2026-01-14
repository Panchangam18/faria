import { applyTextEdits, TextEdit } from '../../services/text-extraction';
import { ToolExecutionResult } from './types';

/**
 * Execute suggest edits tool
 */
export async function executeSuggestEdits(
  edits: TextEdit[],
  targetApp: string | null,
  sendStatus: (status: string) => void
): Promise<ToolExecutionResult> {
  sendStatus('Applying edits...');
  
  const result = await applyTextEdits(targetApp, edits);
  
  if (result.success) {
    return {
      output: `Applied ${result.appliedCount} edit(s)`,
      terminal: true,
      result: { 
        type: 'edits', 
        content: `Applied ${result.appliedCount} edit(s)`,
        edits 
      }
    };
  } else {
    return {
      output: `Edit errors: ${result.errors.join(', ')}`,
      terminal: true,
      result: { 
        type: 'error', 
        content: result.errors.join(', ') 
      }
    };
  }
}

