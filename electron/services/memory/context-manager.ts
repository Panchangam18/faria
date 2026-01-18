import { ContextMessage } from './types';

/**
 * Model context limits (actual maximums)
 */
const MODEL_LIMITS: Record<string, number> = {
  // Anthropic models
  'claude-sonnet-4-20250514': 200000,
  'claude-3-5-sonnet-20241022': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-5-haiku-20241022': 200000,
  // Google models
  'gemini-2.0-flash-exp': 1000000,
  'gemini-1.5-pro': 2000000,
  'gemini-1.5-flash': 1000000,
};

const DEFAULT_LIMIT = 128000;
const CONTEXT_RATIO = 0.5; // Use 50% of available context

/**
 * Get the target context limit for a model (50% of actual limit)
 */
export function getContextLimit(modelName: string): number {
  const fullLimit = MODEL_LIMITS[modelName] || DEFAULT_LIMIT;
  return Math.floor(fullLimit * CONTEXT_RATIO);
}

/**
 * Quick token estimation (approximately 4 characters per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a context message
 */
export function estimateMessageTokens(message: ContextMessage): number {
  if (message.tokenCount) return message.tokenCount;

  if (typeof message.content === 'string') {
    return estimateTokens(message.content);
  }

  return estimateTokens(JSON.stringify(message.content));
}

/**
 * Context manager with FIFO eviction when exceeding 50% context limit
 */
export class ContextManager {
  private messages: ContextMessage[] = [];
  private maxTokens: number;
  private currentTokens: number = 0;

  constructor(modelName: string) {
    this.maxTokens = getContextLimit(modelName);
  }

  /**
   * Add a message to the context, evicting oldest non-system messages if needed
   */
  addMessage(message: Omit<ContextMessage, 'tokenCount' | 'timestamp'>): void {
    const tokenCount = typeof message.content === 'string'
      ? estimateTokens(message.content)
      : estimateTokens(JSON.stringify(message.content));

    const fullMessage: ContextMessage = {
      ...message,
      tokenCount,
      timestamp: Date.now()
    };

    // FIFO: Remove oldest messages if we'd exceed limit
    // Always keep system message (index 0)
    while (this.currentTokens + tokenCount > this.maxTokens && this.messages.length > 1) {
      const removed = this.messages.splice(1, 1)[0];
      this.currentTokens -= removed.tokenCount;
      console.log(`[Context] Removed old message (${removed.tokenCount} tokens, role: ${removed.role})`);
    }

    this.messages.push(fullMessage);
    this.currentTokens += tokenCount;
  }

  /**
   * Get all messages in the context
   */
  getMessages(): ContextMessage[] {
    return this.messages;
  }

  /**
   * Get current token count
   */
  getCurrentTokens(): number {
    return this.currentTokens;
  }

  /**
   * Get maximum token limit
   */
  getMaxTokens(): number {
    return this.maxTokens;
  }

  /**
   * Get context usage as percentage
   */
  getUsagePercent(): number {
    return (this.currentTokens / this.maxTokens) * 100;
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.messages = [];
    this.currentTokens = 0;
  }
}
