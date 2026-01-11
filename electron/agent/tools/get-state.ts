import { ToolResult, ToolContext } from './types';

export async function getState(context: ToolContext): Promise<ToolResult> {
  const state = await context.stateExtractor.extractState();
  context.setCurrentState(state);
  return { success: true, result: context.stateExtractor.formatForAgent(state) };
}

