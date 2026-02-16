import { existsSync, appendFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getMemoryRoot } from '../services/memory/memory-index';

/**
 * Append an interaction summary to the daily memory log.
 * No LLM call needed — hybrid search handles relevance filtering.
 *
 * Format: - [HH:MM] <query summary> → <response summary> (tools: x, y)
 */
export function appendToDailyLog(
  query: string,
  response: string,
  toolsUsed: string[],
): void {
  try {
    const memoryRoot = getMemoryRoot();
    if (!existsSync(memoryRoot)) mkdirSync(memoryRoot, { recursive: true });

    const dateStr = new Date().toISOString().slice(0, 10);
    const dailyFile = join(memoryRoot, `${dateStr}.md`);

    if (!existsSync(dailyFile)) {
      writeFileSync(dailyFile, `# ${dateStr}\n\n`);
    }

    const timestamp = new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });

    const querySummary = query.slice(0, 200).replace(/\n/g, ' ');
    const responseSummary = response.slice(0, 300).replace(/\n/g, ' ');
    const toolsList = toolsUsed.length > 0 ? ` (tools: ${toolsUsed.join(', ')})` : '';

    appendFileSync(dailyFile, `- [${timestamp}] ${querySummary} → ${responseSummary}${toolsList}\n`);
    console.log('[MemoryAgent] Appended to daily log:', dailyFile);
  } catch (error) {
    console.error('[MemoryAgent] Failed to append to daily log:', error);
    // Silent failure — don't affect user experience
  }
}
