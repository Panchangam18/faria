import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult, ToolContext } from './types';
import { runAppleScript, escapeForAppleScript } from '../../services/applescript';

const execAsync = promisify(exec);

export interface ExecuteScriptParams {
  app: string;
  code: string;
  language?: string;
}

export async function executeScript(
  params: ExecuteScriptParams,
  context: ToolContext
): Promise<ToolResult> {
  const { app, code, language } = params;
  
  const method = await context.appRegistry.getScriptingMethod(app);
  
  if (!method || !method.method) {
    return {
      success: false,
      error: `No scripting method found for ${app}. Try run_applescript or run_shell directly.`,
    };
  }
  
  if (language && method.language !== language) {
    return {
      success: false,
      error: `${app} uses ${method.language}, not ${language}`,
    };
  }
  
  switch (method.method) {
    case 'cli':
      if (!method.template) {
        return { success: false, error: 'No CLI template defined' };
      }
      const escapedCode = code.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      const cmd = method.template.replace('{code}', escapedCode);
      const { stdout } = await execAsync(cmd, { timeout: 30000 });
      return { success: true, result: stdout };
      
    case 'applescript_do_javascript':
      if (!method.template) {
        return { success: false, error: 'No AppleScript template defined' };
      }
      const asScript = method.template.replace('{code}', escapeForAppleScript(code));
      const result = await runAppleScript(asScript);
      return { success: true, result };
      
    case 'applescript_do_script':
      if (!method.template) {
        return { success: false, error: 'No AppleScript template defined' };
      }
      const doScriptResult = await runAppleScript(method.template.replace('{code}', escapeForAppleScript(code)));
      return { success: true, result: doScriptResult };
      
    case 'applescript_native':
      const nativeResult = await runAppleScript(code);
      return { success: true, result: nativeResult };
      
    default:
      return { success: false, error: `Unknown method: ${method.method}` };
  }
}

