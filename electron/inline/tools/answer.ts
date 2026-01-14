import { ToolExecutionResult } from './types';

/**
 * Execute answer tool
 */
export function executeAnswer(text: string): ToolExecutionResult {
  return {
    output: text,
    terminal: true,
    result: { type: 'answer', content: text }
  };
}

