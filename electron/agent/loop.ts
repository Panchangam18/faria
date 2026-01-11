import Anthropic from '@anthropic-ai/sdk';
import { BrowserWindow } from 'electron';
import { StateExtractor, AppState } from '../services/state-extractor';
import { ToolExecutor, ToolDefinition } from './tools';
import { LettaClient } from './letta-client';
import { initDatabase } from '../db/sqlite';

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
 */
export class AgentLoop {
  private stateExtractor: StateExtractor;
  private toolExecutor: ToolExecutor;
  private lettaClient: LettaClient | null = null;
  private anthropic: Anthropic | null = null;
  private config: AgentConfig;
  private isRunning = false;
  private shouldCancel = false;
  
  constructor(stateExtractor: StateExtractor, toolExecutor: ToolExecutor) {
    this.stateExtractor = stateExtractor;
    this.toolExecutor = toolExecutor;
    this.config = DEFAULT_CONFIG;
    
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
      this.anthropic = new Anthropic({ apiKey: anthropicKey.value });
    }
    
    // Get Letta API key
    const lettaKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('lettaKey') as { value: string } | undefined;
    if (lettaKey?.value) {
      this.lettaClient = new LettaClient(lettaKey.value);
      await this.lettaClient.initialize();
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
      
      if (!this.anthropic) {
        throw new Error('Anthropic API key not configured. Please add it in Settings.');
      }
      
      // Set the target app for tools to use
      this.toolExecutor.setTargetApp(targetApp || null);
      
      // Extract initial state
      this.sendStatus('Extracting state...');
      let state = await this.stateExtractor.extractState();
      this.toolExecutor.setCurrentState(state);
      
      // Get memory context from Letta
      let memoryContext = '';
      if (this.lettaClient?.isConfigured()) {
        memoryContext = await this.lettaClient.getContext();
      }
      
      // Build initial messages
      const messages: Anthropic.MessageParam[] = [
        {
          role: 'user',
          content: this.buildUserPrompt(query, state, memoryContext),
        },
      ];
      
      // Get tool definitions
      const tools = this.toolExecutor.getToolDefinitions().map(this.convertToolDefinition);
      
      let iterations = 0;
      let finalResponse = '';
      
    while (iterations < this.config.maxIterations && !this.shouldCancel) {
      iterations++;
      
      this.sendStatus('Thinking...');
      console.log(`[Faria] Iteration ${iterations}/${this.config.maxIterations}`);
      
      const response = await this.anthropic.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: SYSTEM_PROMPT,
        messages,
        tools,
      });
      
      console.log(`[Faria] Response stop_reason: ${response.stop_reason}`);
      
      // Process response
      if (response.stop_reason === 'end_turn') {
        // Agent is done
        const textContent = response.content.find(c => c.type === 'text');
        finalResponse = textContent?.text || 'Task completed.';
        console.log(`[Faria] Final response: ${finalResponse.slice(0, 200)}...`);
        break;
      }
      
      if (response.stop_reason === 'tool_use') {
        // Execute tool calls
        const toolUses = response.content.filter(c => c.type === 'tool_use');
        const toolResults: Anthropic.MessageParam['content'] = [];
        
        for (const toolUse of toolUses) {
          if (toolUse.type !== 'tool_use') continue;
          
          console.log(`[Faria] Tool call: ${toolUse.name}`, JSON.stringify(toolUse.input).slice(0, 500));
          this.sendStatus(`${this.getToolDisplayName(toolUse.name)}...`);
          
          const result = await this.toolExecutor.execute(
            toolUse.name,
            toolUse.input as Record<string, unknown>
          );
          
          console.log(`[Faria] Tool result: ${result.success ? 'SUCCESS' : 'FAILED'}`, result.result?.slice(0, 200) || result.error);
          
          // Handle screenshot specially
          let resultContent: string;
          if (toolUse.name === 'take_screenshot' && result.success && result.result?.startsWith('data:image')) {
            resultContent = '[Screenshot captured]';
          } else {
            resultContent = result.success ? (result.result || 'Done') : `Error: ${result.error}`;
          }
          
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: resultContent,
          });
        }
        
        // Add assistant response and tool results to messages
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
        
        // Refresh state after tool execution
        this.sendStatus('Checking result...');
        state = await this.stateExtractor.extractState();
        this.toolExecutor.setCurrentState(state);
        
        // Add updated state context
        messages.push({
          role: 'user',
          content: `Updated state:\n${this.stateExtractor.formatForAgent(state)}`,
        });
      }
    }
      
      // Update Letta memory
      if (this.lettaClient?.isConfigured()) {
        await this.lettaClient.updateMemory(query, finalResponse);
      }
      
      // Save to history
      const db = initDatabase();
      db.prepare('INSERT INTO history (query, response) VALUES (?, ?)').run(query, finalResponse);
      
      this.sendResponse(finalResponse);
      return finalResponse;
    } finally {
      this.isRunning = false;
    }
  }
  
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
      parts.push('=== Memory Context ===');
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
   * Convert tool definition to Anthropic format
   */
  private convertToolDefinition(tool: ToolDefinition): Anthropic.Tool {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters as Anthropic.Tool['input_schema'],
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

