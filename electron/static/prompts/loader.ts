import { AGENT_SYSTEM_PROMPT } from './agent';
import { initDatabase } from '../../db/sqlite';

/**
 * Get the agent system prompt, checking settings first, then falling back to default
 */
export function getAgentSystemPrompt(): string {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('agentSystemPrompt') as { value: string } | undefined;
  return row?.value ?? AGENT_SYSTEM_PROMPT;
}

