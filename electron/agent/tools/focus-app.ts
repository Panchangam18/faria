import { ToolResult, ToolContext } from './types';
import { focusApp as focusAppAS } from '../../services/applescript';

export interface FocusAppParams {
  name: string;
}

export async function focusApp(params: FocusAppParams, context: ToolContext): Promise<ToolResult> {
  await focusAppAS(params.name);
  // Update the target app context so subsequent tools target the newly focused app
  context.setTargetApp(params.name);
  return { success: true, result: `Focused: ${params.name}` };
}

