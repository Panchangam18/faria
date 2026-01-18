import { Memory, MemoryAgentInput, MemoryAgentOutput } from '../services/memory/types';
import { addMemory, deleteMemory, getAllMemories } from '../services/memory/storage';
import { createNativeClient, getSelectedModel } from '../services/models';

const MEMORY_AGENT_PROMPT = `You are a memory management agent. Your job is to analyze interactions and decide what to remember.

You will be given:
1. The user's query
2. The agent's response
3. All current memories

Your task:
- Identify NEW information worth remembering (user preferences, facts about their setup, successful patterns)
- Identify OUTDATED memories that should be deleted (contradicted by new info, no longer relevant)
- Be selective - only store truly useful memories, not every interaction

Output your decisions in this exact JSON format:
{
  "newMemories": ["memory 1 text", "memory 2 text"],
  "deleteMemoryIds": ["id1", "id2"]
}

Guidelines for new memories:
- User preferences: "User prefers dark mode", "User's default browser is Chrome"
- Workflow patterns: "User often sends Slack messages to John about project updates"
- Facts about their setup: "User has VS Code installed", "User's email is john@example.com"
- Successful task patterns: "For sending iMessage, use run_applescript with Messages app"

DO NOT remember:
- One-off queries with no reuse value
- Obvious/generic information
- Information that changes frequently

Keep memories concise (under 100 words each).`;

/**
 * Run the background memory agent to analyze an interaction and manage memories
 */
export async function runMemoryAgent(input: MemoryAgentInput): Promise<void> {
  const modelName = getSelectedModel('selectedModel');
  if (modelName === 'none') return;

  const client = createNativeClient(modelName);
  if (!client) return;

  // Format all memories for context
  const memoriesContext = input.memories.length > 0
    ? input.memories.map(m => `[${m.id}] ${m.content}`).join('\n')
    : '(no memories stored yet)';

  const userMessage = `## User Query
${input.query}

## Agent Response
${input.response}

## Tools Used
${input.toolsUsed?.join(', ') || 'none'}

## Current Memories
${memoriesContext}

Analyze this interaction and output your memory management decisions as JSON.`;

  try {
    let responseText: string;

    if (client.provider === 'anthropic') {
      const response = await client.client.messages.create({
        model: client.model,
        max_tokens: 1024,
        system: MEMORY_AGENT_PROMPT,
        messages: [{ role: 'user', content: userMessage }]
      });

      const textBlock = response.content.find(b => b.type === 'text');
      responseText = textBlock?.text || '{}';
    } else {
      // Google
      const chat = client.model.startChat({
        systemInstruction: { role: 'user', parts: [{ text: MEMORY_AGENT_PROMPT }] }
      });
      const response = await chat.sendMessage(userMessage);
      responseText = response.response.text();
    }

    // Parse the JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[MemoryAgent] No valid JSON in response');
      return;
    }

    const output: MemoryAgentOutput = JSON.parse(jsonMatch[0]);

    // Apply memory operations
    for (const memoryText of output.newMemories || []) {
      if (memoryText.trim()) {
        await addMemory(memoryText.trim());
        console.log('[MemoryAgent] Added memory:', memoryText.slice(0, 50));
      }
    }

    for (const id of output.deleteMemoryIds || []) {
      if (deleteMemory(id)) {
        console.log('[MemoryAgent] Deleted memory:', id);
      }
    }

  } catch (error) {
    console.error('[MemoryAgent] Error:', error);
    // Silent failure - don't affect user experience
  }
}

/**
 * Trigger memory agent in the background (non-blocking)
 */
export function triggerMemoryAgent(input: MemoryAgentInput): void {
  setImmediate(() => {
    runMemoryAgent(input).catch(err => {
      console.error('[MemoryAgent] Background error:', err);
    });
  });
}
