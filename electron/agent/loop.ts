import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { BrowserWindow, screen } from 'electron';
import { StateExtractor, AppState } from '../services/state-extractor';
import { ToolExecutor, ToolDefinition, executeComputerAction, ComputerAction } from './tools';
import { AgentMemory } from './langchain-agent';
import { initDatabase } from '../db/sqlite';
import { traceable } from 'langsmith/traceable';
import { getLangchainCallbacks } from 'langsmith/langchain';
import { AGENT_SYSTEM_PROMPT } from '../static/prompts';

// Load environment variables for LangSmith tracing
import 'dotenv/config';

interface AgentConfig {
  model: string;
  maxIterations: number;
  maxTokens: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  model: 'claude-sonnet-4-20250514',
  maxIterations: 10,
  maxTokens: 4096,
};

/**
 * Agent Loop Controller
 * Orchestrates the agent's reasoning and action cycle
 * Now uses LangChain for LangSmith tracing
 */
export class AgentLoop {
  private stateExtractor: StateExtractor;
  private toolExecutor: ToolExecutor;
  private memory: AgentMemory;
  private model: ChatAnthropic | null = null;
  private config: AgentConfig;
  private isRunning = false;
  private shouldCancel = false;
  
  constructor(stateExtractor: StateExtractor, toolExecutor: ToolExecutor) {
    this.stateExtractor = stateExtractor;
    this.toolExecutor = toolExecutor;
    this.memory = new AgentMemory();
    this.config = DEFAULT_CONFIG;
    
    // Log LangSmith status
    if (process.env.LANGCHAIN_API_KEY && process.env.LANGCHAIN_TRACING_V2 === 'true') {
      console.log('[LangSmith] Tracing enabled for project:', process.env.LANGCHAIN_PROJECT || 'default');
    } else {
      console.log('[LangSmith] Tracing not configured. Set LANGCHAIN_API_KEY and LANGCHAIN_TRACING_V2=true in .env');
    }
    
    this.initializeClients();
  }
  
  /**
   * Initialize API clients
   */
  private async initializeClients(): Promise<void> {
    const db = initDatabase();
    
    // Get selected model from settings, fallback to default
    const selectedModelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('selectedModel') as { value: string } | undefined;
    const modelToUse = selectedModelRow?.value || this.config.model;
    
    // Get Anthropic API key
    const anthropicKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('anthropicKey') as { value: string } | undefined;
    if (anthropicKey?.value) {
      // Use LangChain's ChatAnthropic which automatically integrates with LangSmith
      this.model = new ChatAnthropic({
        model: modelToUse,
        anthropicApiKey: anthropicKey.value,
        maxTokens: this.config.maxTokens,
      });
      console.log(`[Faria] LangChain ChatAnthropic initialized with model: ${modelToUse}`);
    }
  }
  
  /**
   * Run the agent loop for a user query
   * @param query The user's request
   * @param targetApp The app that was focused when the command bar was invoked
   */
  async run(query: string, targetApp?: string | null): Promise<string> {
    if (this.isRunning) {
      throw new Error('Agent is already running');
    }
    
    this.isRunning = true;
    this.shouldCancel = false;
    
    console.log(`[Faria] Starting agent run with targetApp: ${targetApp}`);
    
    try {
      // Refresh API clients in case keys or model were updated
      await this.initializeClients();
      
      if (!this.model) {
        throw new Error('Anthropic API key not configured. Please add it in Settings.');
      }
      
      // Set the target app for tools to use
      this.toolExecutor.setTargetApp(targetApp || null);
      
      // Run the traceable agent loop - this creates a single parent trace in LangSmith
      // with all iterations nested underneath
      const result = await this.executeAgentLoop(query, targetApp);
      
      this.sendResponse(result);
      return result;
    } finally {
      this.isRunning = false;
    }
  }
  
  /**
   * The core agent loop wrapped with LangSmith traceable
   * This ensures all iterations appear under a single trace
   */
  private executeAgentLoop = traceable(
    async (query: string, targetApp?: string | null): Promise<string> => {
      // Extract initial state
      this.sendStatus('Extracting state...');
      let state = await this.stateExtractor.extractState();
      this.toolExecutor.setCurrentState(state);
      
      // Get memory context
      const memoryContext = this.memory.getMemoryContext();
      
      // Build initial messages for LangChain
      const userPrompt = this.buildUserPrompt(query, state, memoryContext);
      const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
        new SystemMessage(AGENT_SYSTEM_PROMPT),
        typeof userPrompt === 'string'
          ? new HumanMessage(userPrompt)
          : new HumanMessage({ content: userPrompt }),
      ];
      
      // Get tool definitions
      const regularTools = this.toolExecutor.getToolDefinitions().map(this.convertToLangChainTool);
      
      // Get screen dimensions for computer use tool
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: displayWidth, height: displayHeight } = primaryDisplay.size;
      
      // Add Claude's computer use tool (Anthropic beta format)
      // This is passed directly to the API as a special tool type
      const computerTool = {
        type: 'computer_20250124' as const,
        name: 'computer',
        display_width_px: displayWidth,
        display_height_px: displayHeight,
      };
      
      // Bind both regular tools and the computer use tool
      const modelWithTools = this.model!.bindTools([...regularTools, computerTool]);
      
      let iterations = 0;
      let finalResponse = '';
      const toolsUsed: string[] = [];
      
      
      while (iterations < this.config.maxIterations && !this.shouldCancel) {
        iterations++;
        
        this.sendStatus('Thinking...');
        console.log(`[Faria] Iteration ${iterations}/${this.config.maxIterations}`);
        
        // Check for cancellation before API call
        if (this.shouldCancel) {
          console.log('[Faria] Cancelled before API call');
          break;
        }
        
        // Get LangChain callbacks that connect to the parent LangSmith trace
        // This ensures model calls appear as children of this agent loop trace
        const callbacks = await getLangchainCallbacks();
        
        // Call LangChain model with callbacks to nest under parent trace
        // Include computer-use beta for Claude's computer use tool
        const response = await modelWithTools.invoke(messages, {
          callbacks,
          tags: ['faria', 'agent-loop'],
          metadata: {
            targetApp,
            iteration: iterations,
            query: query.slice(0, 100),
          },
          betas: ['computer-use-2024-10-22'],
        });
        
        // Check for cancellation after API call
        if (this.shouldCancel) {
          console.log('[Faria] Cancelled after API call');
          break;
        }
        
        console.log(`[Faria] Response received, tool_calls:`, response.tool_calls?.length || 0);
        
        // Check if there are tool calls
        if (response.tool_calls && response.tool_calls.length > 0) {
          // Add the assistant's response with tool calls first
          messages.push(new AIMessage({
            content: response.content as string || '',
            tool_calls: response.tool_calls,
          }));
          
          // Execute tool calls and add ToolMessage for each
          for (const toolCall of response.tool_calls) {
            // Check for cancellation before each tool call
            if (this.shouldCancel) {
              console.log('[Faria] Cancelled before tool execution');
              break;
            }
            
            console.log(`[Faria] Tool call: ${toolCall.name}`, JSON.stringify(toolCall.args).slice(0, 500));
            this.sendStatus(`${this.getToolDisplayName(toolCall.name)}...`);
            toolsUsed.push(toolCall.name);
            
            // Handle computer tool specially
            if (toolCall.name === 'computer') {
              try {
                const computerResult = await executeComputerAction(toolCall.args as ComputerAction);
                console.log(`[Faria] Computer tool result: SUCCESS`);
                
                messages.push(new ToolMessage({
                  content: computerResult,
                  tool_call_id: toolCall.id || toolCall.name,
                }));
              } catch (error) {
                console.log(`[Faria] Computer tool result: FAILED`, error);
                messages.push(new ToolMessage({
                  content: `Error: ${error}`,
                  tool_call_id: toolCall.id || toolCall.name,
                }));
              }
            } else {
              // Use our tool executor for other tools
              const result = await this.toolExecutor.execute(
                toolCall.name,
                toolCall.args as Record<string, unknown>
              );
              
              console.log(`[Faria] Tool result: ${result.success ? 'SUCCESS' : 'FAILED'}`, result.result?.slice(0, 200) || result.error);
              
              const resultContent = result.success ? (result.result || 'Done') : `Error: ${result.error}`;
              
              // Add proper ToolMessage with tool_call_id
              messages.push(new ToolMessage({
                content: resultContent,
                tool_call_id: toolCall.id || toolCall.name,
              }));
            }
          }
          
          // Break out of main loop if cancelled during tool execution
          if (this.shouldCancel) {
            console.log('[Faria] Cancelled after tool execution');
            break;
          }
          
          // Refresh state after tool execution
          this.sendStatus('Checking result...');
          state = await this.stateExtractor.extractState();
          this.toolExecutor.setCurrentState(state);

          // Add updated state context as a human message (with screenshot if fallback)
          const stateText = `Updated state:\n${this.stateExtractor.formatForAgent(state)}`;
          if (state.screenshot) {
            messages.push(new HumanMessage({
              content: [
                { type: 'text', text: stateText },
                { type: 'image_url', image_url: { url: state.screenshot } },
              ],
            }));
          } else {
            messages.push(new HumanMessage(stateText));
          }
        } else {
          // No tool calls - agent is done
          finalResponse = typeof response.content === 'string' 
            ? response.content 
            : 'Task completed.';
          console.log(`[Faria] Final response: ${finalResponse.slice(0, 200)}...`);
          break;
        }
      }
      
      // If cancelled, return empty string (UI already cleared status)
      if (this.shouldCancel) {
        console.log('[Faria] Run cancelled, returning early');
        return '';
      }
      
      // Store interaction in memory
      this.memory.storeMessage('default', 'user', query);
      this.memory.storeMessage('default', 'assistant', finalResponse);
      
      // If tools were used, store as a skill memory
      if (toolsUsed.length > 0) {
        this.memory.storeMemory('skill', `For "${query.slice(0, 50)}..." used tools: ${toolsUsed.join(', ')}`);
      }
      
      // Save to history
      const db = initDatabase();
      db.prepare('INSERT INTO history (query, response, tools_used) VALUES (?, ?, ?)').run(
        query, 
        finalResponse,
        toolsUsed.length > 0 ? JSON.stringify(toolsUsed) : null
      );
      
      return finalResponse;
    },
    {
      name: 'faria-agent-loop',
      run_type: 'chain',
      tags: ['faria', 'agent'],
    }
  );
  
  /**
   * Cancel the current run
   */
  cancel(): void {
    console.log('[Faria] Cancel requested');
    this.shouldCancel = true;
  }
  
  /**
   * Build the user prompt with state context
   * Returns multimodal content if screenshot is present
   */
  private buildUserPrompt(query: string, state: AppState, memoryContext: string): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
    const parts: string[] = [];

    if (memoryContext) {
      parts.push(memoryContext);
      parts.push('');
    }

    parts.push(this.stateExtractor.formatForAgent(state));
    parts.push('');
    parts.push('=== User Request ===');
    parts.push(query);

    const textContent = parts.join('\n');

    // If screenshot fallback, include image
    if (state.screenshot) {
      return [
        { type: 'text', text: textContent },
        { type: 'image_url', image_url: { url: state.screenshot } },
      ];
    }

    return textContent;
  }
  
  /**
   * Convert tool definition to LangChain format
   */
  private convertToLangChainTool(tool: ToolDefinition) {
    return {
      name: tool.name,
      description: tool.description,
      schema: tool.parameters,
    };
  }
  
  /**
   * Get human-readable tool name
   */
  private getToolDisplayName(toolName: string): string {
    const names: Record<string, string> = {
      focus_app: 'Switching app',
      get_state: 'Checking state',
      computer: 'Using computer',
      run_applescript: 'Running AppleScript',
      search_tools: 'Searching tools',
      create_tool: 'Creating tool',
      chain_actions: 'Executing actions',
    };
    return names[toolName] || 'Taking action';
  }
  
  /**
   * Send status update to UI
   */
  private sendStatus(status: string): void {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('agent:status', status);
    });
  }
  
  /**
   * Send response to UI
   */
  private sendResponse(response: string): void {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('agent:response', response);
    });
  }
  
}
