import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult } from './types';

const execAsync = promisify(exec);

export interface RunShellParams {
  command: string;
}

export async function runShell(params: RunShellParams): Promise<ToolResult> {
  const { stdout, stderr } = await execAsync(params.command, { timeout: 30000 });
  return { success: true, result: stdout || stderr };
}

