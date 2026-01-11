import { v4 as uuidv4 } from 'uuid';
import { ToolResult } from './types';
import { initDatabase } from '../../db/sqlite';

export interface CreateToolParams {
  name: string;
  description: string;
  parameters: string;
  code: string;
}

export async function createTool(params: CreateToolParams): Promise<ToolResult> {
  const db = initDatabase();
  const id = uuidv4();
  
  db.prepare(`
    INSERT INTO custom_tools (id, name, description, parameters, code, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(id, params.name, params.description, params.parameters, params.code);
  
  return { success: true, result: `Created tool: ${params.name}` };
}

