/**
 * Inline Agent Loop
 * A lightweight agent for the inline command bar with limited capabilities:
 * 1. Web search to answer questions
 * 2. Text edits within the blast radius
 * 3. Image insertion from web
 * 
 * Now supports multiple LLM providers (Anthropic, Google)
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, FunctionCallingMode } from '@google/generative-ai';
import { config } from 'dotenv';
import { INLINE_TOOLS, INLINE_TOOLS_GOOGLE, executeTool } from './tools';
import type { InlineResult } from './tools/types';
import { INLINE_SYSTEM_PROMPT } from '../static/prompts';
import { 
  getSelectedModel, 
  getProviderName, 
  getMissingKeyError,
  createNativeClient,
  NativeClient
} from '../services/models';

// Load environment variables
config();

interface InlineAgentConfig {
  maxTokens: number;
}

const DEFAULT_CONFIG: InlineAgentConfig = {
  maxTokens: 1024,
};

export type { InlineResult };

export class InlineAgentLoop {
  private config: InlineAgentConfig;
  private onStatus: ((status: string) => void) | null = null;
  private shouldCancel = false;
  
  constructor() {
    this.config = DEFAULT_CONFIG;
  }
  
  /**
   * Cancel the current run
   */
  cancel(): void {
    console.log('[InlineAgent] Cancel requested');
    this.shouldCancel = true;
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
    
    // Get selected model and create client
    const modelName = getSelectedModel('selectedInlineModel');
    const provider = getProviderName(modelName);
    const nativeClient = createNativeClient(modelName);
    
    if (!nativeClient) {
      return { type: 'error', content: getMissingKeyError(modelName) };
    }
    
    // Build the user message with context
    let userMessage = query;
    if (contextText) {
      userMessage = `Context text around cursor (${contextText.split(/\s+/).length} words):\n\`\`\`\n${contextText}\n\`\`\`\n\nUser request: ${query}`;
    }
    
    this.sendStatus('Thinking...');
    
    try {
      if (provider === 'google') {
        return await this.runWithGoogle(nativeClient as Extract<NativeClient, { provider: 'google' }>, userMessage, targetApp, contextText);
      } else {
        return await this.runWithAnthropic(nativeClient as Extract<NativeClient, { provider: 'anthropic' }>, userMessage, targetApp, contextText);
      }
    } catch (error) {
      console.error('[InlineAgent] Error:', error);
      return { type: 'error', content: String(error) };
    }
  }
  
  /**
   * Run with Anthropic (Claude)
   */
  private async runWithAnthropic(
    nativeClient: Extract<NativeClient, { provider: 'anthropic' }>,
    userMessage: string,
    targetApp: string | null,
    contextText: string | null
  ): Promise<InlineResult> {
    const { client, model: modelName } = nativeClient;
    
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage }
    ];
    
    // Check for cancellation before API call
    if (this.shouldCancel) {
      console.log('[InlineAgent] Cancelled before API call');
      return { type: 'answer', content: '' };
    }
    
    // First API call
    let response = await client.messages.create({
      model: modelName,
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
      
      response = await client.messages.create({
        model: modelName,
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
  }
  
  /**
   * Run with Google (Gemini)
   */
  private async runWithGoogle(
    nativeClient: Extract<NativeClient, { provider: 'google' }>,
    userMessage: string,
    targetApp: string | null,
    contextText: string | null
  ): Promise<InlineResult> {
    const { model } = nativeClient;
    
    // Check for cancellation before API call
    if (this.shouldCancel) {
      console.log('[InlineAgent] Cancelled before API call');
      return { type: 'answer', content: '' };
    }
    
    // Start chat with tools
    const chat = model.startChat({
      systemInstruction: INLINE_SYSTEM_PROMPT,
      tools: [{
        functionDeclarations: INLINE_TOOLS_GOOGLE
      }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingMode.AUTO
        }
      }
    });
    
    // First API call
    let response = await chat.sendMessage(userMessage);
    
    // Check for cancellation after API call
    if (this.shouldCancel) {
      console.log('[InlineAgent] Cancelled after API call');
      return { type: 'answer', content: '' };
    }
    
    // Handle function calls
    let functionCalls = response.response.functionCalls();
    
    while (functionCalls && functionCalls.length > 0 && !this.shouldCancel) {
      const functionResponses = [];
      
      for (const functionCall of functionCalls) {
        // Check for cancellation before each tool
        if (this.shouldCancel) {
          console.log('[InlineAgent] Cancelled before tool execution');
          return { type: 'answer', content: '' };
        }
        
        const result = await executeTool(
          functionCall.name,
          functionCall.args,
          targetApp,
          contextText,
          (status: string) => this.sendStatus(status)
        );
        
        // If this is a terminal action (edits, image, answer), return immediately
        if (result.terminal) {
          return result.result;
        }
        
        functionResponses.push({
          name: functionCall.name,
          response: { result: result.output }
        });
      }
      
      // Check for cancellation after tool execution
      if (this.shouldCancel) {
        console.log('[InlineAgent] Cancelled after tool execution');
        return { type: 'answer', content: '' };
      }
      
      // Send function responses back
      response = await chat.sendMessage(functionResponses.map(fr => ({
        functionResponse: fr
      })));
      
      functionCalls = response.response.functionCalls();
    }
    
    // Check for cancellation at end
    if (this.shouldCancel) {
      console.log('[InlineAgent] Cancelled at end');
      return { type: 'answer', content: '' };
    }
    
    // Extract final text response
    const text = response.response.text();
    
    return {
      type: 'answer',
      content: text || 'Done.'
    };
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
