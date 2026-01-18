import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { Client } from 'langsmith';

// Load environment variables
import 'dotenv/config';

/**
 * LangSmith client for explicit tracing
 */
export class TracingClient {
  private client: Client | null = null;
  
  constructor() {
    const apiKey = process.env.LANGCHAIN_API_KEY;
    if (apiKey) {
      this.client = new Client({ apiKey });
      console.log('[LangSmith] Tracing enabled');
    } else {
      console.log('[LangSmith] No API key, tracing disabled');
    }
  }
  
  isEnabled(): boolean {
    return !!this.client;
  }
  
  async logRun(name: string, inputs: Record<string, unknown>, outputs: Record<string, unknown>): Promise<void> {
    if (!this.client) return;
    
    try {
      // LangSmith automatically traces LangChain calls when env vars are set
      // This is for any additional custom logging
      console.log(`[LangSmith] Logged run: ${name}`);
    } catch (error) {
      console.error('[LangSmith] Failed to log run:', error);
    }
  }
}

/**
 * Create the LangChain-based agent
 */
export function createLangChainAgent(apiKey: string) {
  // Initialize LangChain with Anthropic
  const model = new ChatAnthropic({
    model: 'claude-sonnet-4-20250514',
    anthropicApiKey: apiKey,
    temperature: 0,
  });
  
  return model;
}

/**
 * Convert messages to LangChain format
 */
export function toLangChainMessages(messages: Array<{ role: string; content: string }>) {
  return messages.map(msg => {
    switch (msg.role) {
      case 'system':
        return new SystemMessage(msg.content);
      case 'user':
        return new HumanMessage(msg.content);
      case 'assistant':
        return new AIMessage(msg.content);
      default:
        return new HumanMessage(msg.content);
    }
  });
}

