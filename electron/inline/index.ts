/**
 * Inline Agent Loop
 * A lightweight agent for the inline command bar with limited capabilities:
 * 1. Web search to answer questions
 * 2. Text edits within the blast radius
 * 3. Image insertion from web
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { initDatabase } from '../db/sqlite';
import { INLINE_TOOLS, executeTool } from './tools';
import type { InlineResult } from './tools/types';
import { INLINE_SYSTEM_PROMPT } from '../static/prompts';

// Load environment variables
config();

interface InlineAgentConfig {
  model: string;
  maxTokens: number;
}

const DEFAULT_CONFIG: InlineAgentConfig = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 1024,
};

export type { InlineResult };

export class InlineAgentLoop {
  private client: Anthropic | null = null;
  private config: InlineAgentConfig;
  private onStatus: ((status: string) => void) | null = null;
  private shouldCancel = false;
  
  constructor() {
    this.config = DEFAULT_CONFIG;
    this.initializeClient();
  }
  
  /**
   * Cancel the current run
   */
  cancel(): void {
    console.log('[InlineAgent] Cancel requested');
    this.shouldCancel = true;
  }
  
  private initializeClient(): void {
    const db = initDatabase();
    
    // Get selected inline model from settings, fallback to default
    const selectedInlineModelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('selectedInlineModel') as { value: string } | undefined;
    const modelToUse = selectedInlineModelRow?.value || this.config.model;
    this.config.model = modelToUse;
    
    const anthropicKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('anthropicKey') as { value: string } | undefined;
    
    if (anthropicKey?.value) {
      this.client = new Anthropic({
        apiKey: anthropicKey.value
      });
      console.log(`[InlineAgent] Initialized with model: ${modelToUse}`);
    }
  }
  
  setStatusCallback(callback: (status: string) => void): void {
    this.onStatus = callback;
  }
  
  private sendStatus(status: string): void {
    if (this.onStatus) {
      this.onStatus(status);
    }
  }
  
  /**
   * Run the inline agent
   */
  async run(
    query: string, 
    contextText: string | null,
    targetApp: string | null
  ): Promise<InlineResult> {
    // Reset cancel flag at start of run
    this.shouldCancel = false;
    
    if (!this.client) {
      this.initializeClient();
      if (!this.client) {
        return { type: 'error', content: 'API key not configured. Add your Anthropic key in Settings.' };
      }
    }
    
    // Refresh model setting in case it was changed
    const db = initDatabase();
    const selectedInlineModelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('selectedInlineModel') as { value: string } | undefined;
    if (selectedInlineModelRow?.value) {
      this.config.model = selectedInlineModelRow.value;
    }
    
    // Build the user message with context
    let userMessage = query;
    if (contextText) {
      userMessage = `Context text around cursor (${contextText.split(/\s+/).length} words):\n\`\`\`\n${contextText}\n\`\`\`\n\nUser request: ${query}`;
    }
    
    this.sendStatus('Thinking...');
    
    try {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: userMessage }
      ];
      
      // Check for cancellation before API call
      if (this.shouldCancel) {
        console.log('[InlineAgent] Cancelled before API call');
        return { type: 'answer', content: '' };
      }
      
      // First API call
      let response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: INLINE_SYSTEM_PROMPT,
        tools: INLINE_TOOLS,
        messages
      });
      
      // Check for cancellation after API call
      if (this.shouldCancel) {
        console.log('[InlineAgent] Cancelled after API call');
        return { type: 'answer', content: '' };
      }
      
      // Handle tool use
      while (response.stop_reason === 'tool_use' && !this.shouldCancel) {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );
        
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        
        for (const toolUse of toolUseBlocks) {
          // Check for cancellation before each tool
          if (this.shouldCancel) {
            console.log('[InlineAgent] Cancelled before tool execution');
            return { type: 'answer', content: '' };
          }
          
          const result = await executeTool(
            toolUse.name,
            toolUse.input,
            targetApp,
            contextText,
            (status: string) => this.sendStatus(status)
          );
          
          // If this is a terminal action (edits, image, answer), return immediately
          if (result.terminal) {
            return result.result;
          }
          
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result.output
          });
        }
        
        // Check for cancellation after tool execution
        if (this.shouldCancel) {
          console.log('[InlineAgent] Cancelled after tool execution');
          return { type: 'answer', content: '' };
        }
        
        // Continue conversation with tool results
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
        
        response = await this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: INLINE_SYSTEM_PROMPT,
          tools: INLINE_TOOLS,
          messages
        });
      }
      
      // Check for cancellation at end
      if (this.shouldCancel) {
        console.log('[InlineAgent] Cancelled at end');
        return { type: 'answer', content: '' };
      }
      
      // Extract final text response
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      
      return {
        type: 'answer',
        content: textBlock?.text || 'Done.'
      };
      
    } catch (error) {
      console.error('[InlineAgent] Error:', error);
      return { type: 'error', content: String(error) };
    }
  }
}

// Singleton instance
let inlineAgent: InlineAgentLoop | null = null;

export function getInlineAgent(): InlineAgentLoop {
  if (!inlineAgent) {
    inlineAgent = new InlineAgentLoop();
  }
  return inlineAgent;
}

