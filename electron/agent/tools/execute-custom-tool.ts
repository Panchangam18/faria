import { ToolResult, ToolContext } from './types';
import { initDatabase } from '../../db/sqlite';

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
  
  try {
    // Execute custom tool code
    // Custom tools are pure functions that take params and return results
    // They should compose built-in tools rather than accessing low-level primitives
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('params', tool.code);
    const result = await fn(params);
    return { success: true, result: String(result) };
  } catch (error) {
    return { success: false, error: `Custom tool error: ${error}` };
  }
}

