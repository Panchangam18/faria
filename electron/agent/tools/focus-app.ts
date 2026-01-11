import { ToolResult } from './types';
import { focusApp as focusAppAS } from '../../services/applescript';

export interface FocusAppParams {
  name: string;
}

export async function focusApp(params: FocusAppParams): Promise<ToolResult> {
  await focusAppAS(params.name);
  return { success: true, result: `Focused: ${params.name}` };
}

