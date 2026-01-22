import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { runAppleScript } from '../../services/applescript';
import { ToolResult } from './types';

// Zod schema for the tool
export const RunAppleScriptSchema = z.object({
  script: z.string().describe('The AppleScript code to execute'),
});

// Factory function that creates the tool
export function createRunAppleScriptTool(): DynamicStructuredTool {
  return tool(
    async (input) => {
      const result = await runAppleScript(input.script);
      return result;
    },
    {
      name: 'run_applescript',
      description: 'Execute raw AppleScript code',
      schema: RunAppleScriptSchema,
    }
  );
}

// Legacy interface and function for backward compatibility during migration
export interface RunAppleScriptParams {
  script: string;
}

export async function runAppleScriptTool(params: RunAppleScriptParams): Promise<ToolResult> {
  const result = await runAppleScript(params.script);
  return { success: true, result };
}

