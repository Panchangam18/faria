import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ToolResult, ToolContext } from './types';
import { focusApp as focusAppAS } from '../../services/applescript';

// Zod schema for the tool
export const FocusAppSchema = z.object({
  name: z.string().describe('Name of the application to focus'),
});

/**
 * Factory function that creates the focus app tool with context injected
 */
export function createFocusAppTool(context: ToolContext): DynamicStructuredTool {
  return tool(
    async (input) => {
      await focusAppAS(input.name);
      // Update the target app context so subsequent tools target the newly focused app
      context.setTargetApp(input.name);
      return `Focused: ${input.name}`;
    },
    {
      name: 'focus_app',
      description: 'Bring an application to the foreground',
      schema: FocusAppSchema,
    }
  );
}

// Legacy interface and function for backward compatibility during migration
export interface FocusAppParams {
  name: string;
}

export async function focusApp(params: FocusAppParams, context: ToolContext): Promise<ToolResult> {
  await focusAppAS(params.name);
  // Update the target app context so subsequent tools target the newly focused app
  context.setTargetApp(params.name);
  return { success: true, result: `Focused: ${params.name}` };
}

