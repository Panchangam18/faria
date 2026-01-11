import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { BrowserWindow } from 'electron';
import { StateExtractor, AppState } from '../services/state-extractor';
import { ToolExecutor, ToolDefinition } from './tools';
import { AgentMemory } from './langchain-agent';
import { initDatabase } from '../db/sqlite';
import { traceable } from 'langsmith/traceable';
import { getLangchainCallbacks } from 'langsmith/langchain';

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

const SYSTEM_PROMPT = `You are Faria, an intelligent computer copilot. Your job is to TAKE ACTION, not explain or ask questions.

CRITICAL RULES:
1. ALWAYS attempt to take action first. Never ask for clarification if you can make a reasonable attempt.
2. If the user says "add text" or "type" - use send_keystrokes immediately. The text will go wherever the cursor is.
3. For web apps like Google Docs, typing via send_keystrokes works - just do it.
4. Don't describe what you see - ACT on it.
5. Be extremely brief in responses. One sentence max after completing an action.

Your tools:
- send_keystrokes(text) - Types text at the current cursor position. USE THIS for any "type", "write", "add" request.
- send_hotkey(modifiers, key) - Keyboard shortcuts like Cmd+V, Cmd+A
- click(target) - Click element by ID [1] or coordinates {x, y}
- scroll(direction) - Scroll up/down/left/right
- execute_script(app, code) - Run code in apps like Blender, Photoshop

WORKFLOW:
1. User asks to type/add text → Use send_keystrokes immediately
2. User asks to click something → Find it in elements list, use click with ID
3. User asks to do something complex → Break it into simple steps, execute each

Elements in state are labeled [1], [2], etc. Use these IDs with click().
The focused element is where keystrokes will go.

DO NOT: Ask clarifying questions, explain what you're going to do, describe the interface.
DO: Take action immediately, report success/failure briefly.`;

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
    
    // Get Anthropic API key
    const anthropicKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('anthropicKey') as { value: string } | undefined;
    if (anthropicKey?.value) {
      // Use LangChain's ChatAnthropic which automatically integrates with LangSmith
      this.model = new ChatAnthropic({
        model: this.config.model,
        anthropicApiKey: anthropicKey.value,
        maxTokens: this.config.maxTokens,
      });
      console.log('[Faria] LangChain ChatAnthropic initialized');
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
      // Refresh API clients in case keys were updated
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
      const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(this.buildUserPrompt(query, state, memoryContext)),
      ];
      
      // Get tool definitions and bind to model
      const tools = this.toolExecutor.getToolDefinitions().map(this.convertToLangChainTool);
      const modelWithTools = this.model!.bindTools(tools);
      
      let iterations = 0;
      let finalResponse = '';
      const toolsUsed: string[] = [];
      
      while (iterations < this.config.maxIterations && !this.shouldCancel) {
        iterations++;
        
        this.sendStatus('Thinking...');
        console.log(`[Faria] Iteration ${iterations}/${this.config.maxIterations}`);
        
        // Get LangChain callbacks that connect to the parent LangSmith trace
        // This ensures model calls appear as children of this agent loop trace
        const callbacks = await getLangchainCallbacks();
        
        // Call LangChain model with callbacks to nest under parent trace
        const response = await modelWithTools.invoke(messages, {
          callbacks,
          tags: ['faria', 'agent-loop'],
          metadata: {
            targetApp,
            iteration: iterations,
            query: query.slice(0, 100),
          },
        });
        
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
            console.log(`[Faria] Tool call: ${toolCall.name}`, JSON.stringify(toolCall.args).slice(0, 500));
            this.sendStatus(`${this.getToolDisplayName(toolCall.name)}...`);
            toolsUsed.push(toolCall.name);
            
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
          
          // Refresh state after tool execution
          this.sendStatus('Checking result...');
          state = await this.stateExtractor.extractState();
          this.toolExecutor.setCurrentState(state);
          
          // Add updated state context as a human message
          messages.push(new HumanMessage(`Updated state:\n${this.stateExtractor.formatForAgent(state)}`));
        } else {
          // No tool calls - agent is done
          finalResponse = typeof response.content === 'string' 
            ? response.content 
            : 'Task completed.';
          console.log(`[Faria] Final response: ${finalResponse.slice(0, 200)}...`);
          break;
        }
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
    this.shouldCancel = true;
  }
  
  /**
   * Build the user prompt with state context
   */
  private buildUserPrompt(query: string, state: AppState, memoryContext: string): string {
    const parts: string[] = [];
    
    if (memoryContext) {
      parts.push(memoryContext);
      parts.push('');
    }
    
    parts.push(this.stateExtractor.formatForAgent(state));
    parts.push('');
    parts.push('=== User Request ===');
    parts.push(query);
    
    return parts.join('\n');
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
      execute_script: 'Running script',
      send_keystrokes: 'Typing',
      send_hotkey: 'Pressing keys',
      click: 'Clicking',
      scroll: 'Scrolling',
      focus_app: 'Switching app',
      get_state: 'Checking state',
      take_screenshot: 'Taking screenshot',
      find_replace: 'Finding & replacing',
      run_applescript: 'Running AppleScript',
      run_shell: 'Running command',
      search_tools: 'Searching tools',
      create_tool: 'Creating tool',
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
