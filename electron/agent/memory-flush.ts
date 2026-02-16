import { existsSync, appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ContextManager } from '../services/memory/context-manager';
import { getMemoryRoot } from '../services/memory/memory-index';
import { createNativeClient, getSelectedModel } from '../services/models';

const FLUSH_THRESHOLD_PERCENT = 60;

const MEMORY_FLUSH_SYSTEM_PROMPT = `You are a memory extraction agent. Your job is to identify durable facts from the conversation that should be preserved before context is lost.

Extract ONLY information worth remembering long-term:
- User preferences, habits, and workflow patterns
- Facts about their setup, tools, accounts
- Decisions made and their reasoning
- Successful approaches to problems
- Names, roles, and relationships mentioned

Output format — one bullet point per memory, or [NO_FLUSH] if nothing worth saving:
- User prefers dark mode in all apps
- Project uses React + Vite + Electron
- Decided to use SQLite for memory storage because of single-file simplicity`;

const MEMORY_FLUSH_PROMPT = `Session is nearing context limits. Review the conversation above and extract any durable facts or preferences worth preserving. Write them as bullet points. If there is nothing new worth saving, reply with exactly [NO_FLUSH].`;

let lastFlushTokenCount = 0;

/**
 * Check whether a memory flush should run based on context usage.
 * Returns true when usage hits 60% and we haven't flushed recently.
 */
export function shouldRunMemoryFlush(contextManager: ContextManager): boolean {
  const usage = contextManager.getUsagePercent();
  const currentTokens = contextManager.getCurrentTokens();

  // Don't re-trigger until context has grown significantly past last flush
  if (lastFlushTokenCount > 0 && currentTokens < lastFlushTokenCount * 1.3) {
    return false;
  }

  return usage >= FLUSH_THRESHOLD_PERCENT;
}

/**
 * Run a silent memory flush — one-shot LLM call that extracts durable facts
 * from the current conversation and appends them to the daily log.
 *
 * @param conversationSummary A text summary of recent messages for the flush model
 * @returns true if memories were written, false if [NO_FLUSH] or error
 */
export async function runMemoryFlush(conversationSummary: string): Promise<boolean> {
  const modelName = getSelectedModel('selectedModel');
  if (modelName === 'none') return false;

  const client = createNativeClient(modelName);
  if (!client) return false;

  try {
    let responseText: string;

    if (client.provider === 'anthropic') {
      const response = await client.client.messages.create({
        model: client.model,
        max_tokens: 1024,
        system: MEMORY_FLUSH_SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: conversationSummary + '\n\n' + MEMORY_FLUSH_PROMPT },
        ],
      });
      const textBlock = response.content.find((b) => b.type === 'text') as { type: 'text'; text: string } | undefined;
      responseText = textBlock?.text || '[NO_FLUSH]';
    } else {
      // Google
      const chat = client.model.startChat({
        systemInstruction: { role: 'user', parts: [{ text: MEMORY_FLUSH_SYSTEM_PROMPT }] },
      });
      const response = await chat.sendMessage(conversationSummary + '\n\n' + MEMORY_FLUSH_PROMPT);
      responseText = response.response.text();
    }

    // Check for no-op
    if (responseText.trim() === '[NO_FLUSH]' || !responseText.trim()) {
      console.log('[MemoryFlush] Nothing to flush');
      return false;
    }

    // Append to daily log
    appendToFlushLog(responseText.trim());
    console.log('[MemoryFlush] Flushed memories to daily log');
    return true;
  } catch (error) {
    console.error('[MemoryFlush] Error:', error);
    return false;
  }
}

/**
 * Record the current token count after a flush to prevent re-triggering.
 */
export function recordFlush(tokenCount: number): void {
  lastFlushTokenCount = tokenCount;
}

/**
 * Reset flush tracking (e.g., at start of new agent run).
 */
export function resetFlushTracking(): void {
  lastFlushTokenCount = 0;
}

function appendToFlushLog(content: string): void {
  const memoryRoot = getMemoryRoot();
  if (!existsSync(memoryRoot)) mkdirSync(memoryRoot, { recursive: true });

  const dateStr = new Date().toISOString().slice(0, 10);
  const dailyFile = join(memoryRoot, `${dateStr}.md`);

  if (!existsSync(dailyFile)) {
    writeFileSync(dailyFile, `# ${dateStr}\n\n`);
  }

  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  appendFileSync(dailyFile, `\n## Memory Flush [${timestamp}]\n${content}\n`);
}
