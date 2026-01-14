import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolResult, ToolContext } from './types';
import { initDatabase } from '../../db/sqlite';
import { runAppleScript, focusApp as focusAppAS } from '../../services/applescript';
import { sendKeystrokes as cliSendKeystrokes, sendHotkey as cliSendHotkey, click as cliClick, scroll as cliScroll, sleep } from '../../services/cliclick';
import { click } from './click';

const execAsync = promisify(exec);

export async function executeCustomTool(
  toolName: string,
  params: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const db = initDatabase();
  const tool = db.prepare('SELECT * FROM custom_tools WHERE name = ?').get(toolName) as {
    id: string;
    code: string;
    usage_count: number;
  } | undefined;
  
  if (!tool) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }
  
  // Update usage count
  db.prepare('UPDATE custom_tools SET usage_count = usage_count + 1 WHERE id = ?').run(tool.id);
  
  // Create context for custom tool execution
  const toolContext = {
    builtInTools: {
      sendKeystrokes: (text: string) => cliSendKeystrokes(text),
      sendHotkey: (mods: string[], key: string) => cliSendHotkey(mods, key),
      click: async (x: number, y: number) => {
        const result = await click({ x, y }, context);
        if (!result.success) throw new Error(result.error);
      },
      focusApp: (name: string) => focusAppAS(name),
      getState: () => context.stateExtractor.extractState(),
      scroll: (dir: 'up' | 'down' | 'left' | 'right', amt?: number) => cliScroll(dir, amt),
    },
    runAppleScript,
    runShell: async (cmd: string) => {
      const { stdout } = await execAsync(cmd);
      return stdout;
    },
    sleep,
  };
  
  try {
    // Execute custom tool code
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('params', 'context', tool.code);
    const result = await fn(params, toolContext);
    return { success: true, result: String(result) };
  } catch (error) {
    return { success: false, error: `Custom tool error: ${error}` };
  }
}

