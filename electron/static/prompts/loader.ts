import { INLINE_SYSTEM_PROMPT } from './inline';
import { AGENT_SYSTEM_PROMPT } from './agent';
import { initDatabase } from '../../db/sqlite';

/**
 * Get the inline system prompt, checking settings first, then falling back to default
 */
export function getInlineSystemPrompt(): string {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('inlineSystemPrompt') as { value: string } | undefined;
  return row?.value ?? INLINE_SYSTEM_PROMPT;
}

/**
 * Get the agent system prompt, checking settings first, then falling back to default
 */
export function getAgentSystemPrompt(): string {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('agentSystemPrompt') as { value: string } | undefined;
  return row?.value ?? AGENT_SYSTEM_PROMPT;
}

