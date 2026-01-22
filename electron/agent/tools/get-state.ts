import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ToolResult, ToolContext } from './types';

// Zod schema for the tool (empty object since no parameters)
export const GetStateSchema = z.object({});

/**
 * Factory function that creates the get state tool with context injected
 */
export function createGetStateTool(context: ToolContext): DynamicStructuredTool {
  return tool(
    async () => {
      const state = await context.stateExtractor.extractState();
      context.setCurrentState(state);
      return context.stateExtractor.formatForAgent(state);
    },
    {
      name: 'get_state',
      description: 'Re-extract the current application state',
      schema: GetStateSchema,
    }
  );
}

// Legacy function for backward compatibility during migration
export async function getState(context: ToolContext): Promise<ToolResult> {
  const state = await context.stateExtractor.extractState();
  context.setCurrentState(state);
  return { success: true, result: context.stateExtractor.formatForAgent(state) };
}

