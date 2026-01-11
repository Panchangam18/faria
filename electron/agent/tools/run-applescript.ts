import { ToolResult } from './types';
import { runAppleScript } from '../../services/applescript';

export interface RunAppleScriptParams {
  script: string;
}

export async function runAppleScriptTool(params: RunAppleScriptParams): Promise<ToolResult> {
  const result = await runAppleScript(params.script);
  return { success: true, result };
}

