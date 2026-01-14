import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { BrowserWindow, screen } from 'electron';
import { StateExtractor, AppState } from '../services/state-extractor';
import { ToolExecutor, ToolDefinition } from './tools';
import { AgentMemory } from './langchain-agent';
import { initDatabase } from '../db/sqlite';
import { traceable } from 'langsmith/traceable';
import { getLangchainCallbacks } from 'langsmith/langchain';
import { takeScreenshot } from '../services/screenshot';
import * as cliclick from '../services/cliclick';

// Load environment variables for LangSmith tracing
import 'dotenv/config';

// Computer use action type
interface ComputerAction {
  action: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  end_coordinate?: [number, number];
  text?: string;
  key?: string;
  scroll_direction?: 'up' | 'down' | 'left' | 'right';
  scroll_amount?: number;
  duration?: number;
}

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
2. MAXIMUM EFFICIENCY: Complete ENTIRE tasks in ONE tool call. Use chain_actions for multi-step UI tasks.
3. If the user says "add text" or "type" - use send_keystrokes immediately.
4. Don't describe what you see - ACT on it.
5. Be extremely brief in responses. One sentence max after completing an action.
6. TRUST that chain_actions succeeded - don't retry or verify with additional tool calls.

Your tools:
- chain_actions(actions) - PREFERRED for multi-step tasks. Chains actions with automatic timing. No delays needed!
- run_applescript(script) - For app-specific APIs (opening URLs, sending iMessages, file operations)
- send_keystrokes(text) - Types text at the current cursor position
- send_hotkey(modifiers, key) - Keyboard shortcuts like Cmd+V, Cmd+A  
- click(x, y) - Click at coordinates
- scroll(direction) - Scroll up/down/left/right
- computer(action) - Screenshot, click, type (use for visual tasks)

CHAIN_ACTIONS - Use for UI automation (timing handled automatically):

Send a Slack/Discord/Teams message:
chain_actions({ actions: [
  { type: "activate", app: "Slack" },
  { type: "hotkey", modifiers: ["cmd"], key: "k" },
  { type: "type", text: "John Smith" },
  { type: "key", key: "return" },
  { type: "type", text: "Hey, here's the update!" },
  { type: "key", key: "return" }
]})

Search and open in Spotlight:
chain_actions({ actions: [
  { type: "hotkey", modifiers: ["cmd"], key: "space" },
  { type: "type", text: "Visual Studio Code" },
  { type: "key", key: "return" }
]})

Click and type in a form:
chain_actions({ actions: [
  { type: "click", x: 500, y: 300 },
  { type: "type", text: "Hello world" },
  { type: "key", key: "tab" },
  { type: "type", text: "More text" }
]})

RUN_APPLESCRIPT - Use for direct app APIs (no UI simulation):

Open URL directly:
run_applescript({ script: 'tell application "Google Chrome" to set URL of active tab of window 1 to "https://example.com"' })

Send iMessage:
run_applescript({ script: 'tell application "Messages" to send "Hello!" to buddy "john@example.com"' })

WORKFLOW:
1. Message someone → ONE chain_actions call: activate app, hotkey to search, type name, enter, type message, enter
2. Open URL → ONE run_applescript call: set URL directly
3. Fill form → ONE chain_actions call: clicks and types in sequence

CRITICAL - WHEN TO STOP:
- After chain_actions returns "SUCCESS Completed N actions..." → YOU ARE DONE. Respond with a brief confirmation like "Done" or "Message sent".
- NEVER make additional tool calls after chain_actions succeeds for the same task.
- NEVER try to "verify" or "ensure" the action worked by sending more keystrokes or clicks.
- The UI state you see AFTER a successful chain_actions may look different, but that doesn't mean you need to do more. TRUST THE SUCCESS MESSAGE.

Elements in state are labeled [1], [2], etc.

DO NOT: Use multiple tool calls for one task. Add manual delays. Retry after success. Make "verification" tool calls.
DO: Complete everything in ONE tool call. Trust chain_actions timing. Respond with brief confirmation text (no tool calls) after success.`;

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
      const userPrompt = this.buildUserPrompt(query, state, memoryContext);
      const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
        new SystemMessage(SYSTEM_PROMPT),
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
                const computerResult = await this.executeComputerAction(toolCall.args as ComputerAction);
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
      execute_script: 'Running script',
      send_keystrokes: 'Typing',
      send_hotkey: 'Pressing keys',
      click: 'Clicking',
      scroll: 'Scrolling',
      focus_app: 'Switching app',
      get_state: 'Checking state',
      computer: 'Using computer',
      find_replace: 'Finding & replacing',
      run_applescript: 'Running AppleScript',
      run_shell: 'Running command',
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
  
  /**
   * Execute a computer use tool action
   * Returns content for ToolMessage (string or image array)
   */
  private async executeComputerAction(action: ComputerAction): Promise<string | Array<{ type: string; source?: { type: string; media_type: string; data: string } }>> {
    console.log(`[Faria] Computer action: ${action.action}`, JSON.stringify(action).slice(0, 200));
    
    switch (action.action) {
      case 'screenshot': {
        const screenshot = await takeScreenshot();
        // Return base64 data without the data:image/png;base64, prefix
        const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
        return [{
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: base64Data,
          },
        }];
      }
      
      case 'left_click': {
        if (action.coordinate) {
          await cliclick.click(action.coordinate[0], action.coordinate[1]);
          return `Clicked at (${action.coordinate[0]}, ${action.coordinate[1]})`;
        }
        throw new Error('Coordinate required for left_click');
      }
      
      case 'right_click': {
        if (action.coordinate) {
          await cliclick.rightClick(action.coordinate[0], action.coordinate[1]);
          return `Right-clicked at (${action.coordinate[0]}, ${action.coordinate[1]})`;
        }
        throw new Error('Coordinate required for right_click');
      }
      
      case 'middle_click': {
        if (action.coordinate) {
          // Middle click - use cliclick with middle button
          await cliclick.click(action.coordinate[0], action.coordinate[1]);
          return `Middle-clicked at (${action.coordinate[0]}, ${action.coordinate[1]})`;
        }
        throw new Error('Coordinate required for middle_click');
      }
      
      case 'double_click': {
        if (action.coordinate) {
          await cliclick.doubleClick(action.coordinate[0], action.coordinate[1]);
          return `Double-clicked at (${action.coordinate[0]}, ${action.coordinate[1]})`;
        }
        throw new Error('Coordinate required for double_click');
      }
      
      case 'triple_click': {
        if (action.coordinate) {
          // Triple click - three rapid clicks
          await cliclick.click(action.coordinate[0], action.coordinate[1]);
          await cliclick.click(action.coordinate[0], action.coordinate[1]);
          await cliclick.click(action.coordinate[0], action.coordinate[1]);
          return `Triple-clicked at (${action.coordinate[0]}, ${action.coordinate[1]})`;
        }
        throw new Error('Coordinate required for triple_click');
      }
      
      case 'mouse_move': {
        if (action.coordinate) {
          await cliclick.moveMouse(action.coordinate[0], action.coordinate[1]);
          return `Moved mouse to (${action.coordinate[0]}, ${action.coordinate[1]})`;
        }
        throw new Error('Coordinate required for mouse_move');
      }
      
      case 'type': {
        if (action.text) {
          await cliclick.sendKeystrokes(action.text);
          return `Typed: "${action.text}"`;
        }
        throw new Error('Text required for type action');
      }
      
      case 'key': {
        if (action.key) {
          // Parse key combination like "cmd+t" or "Return"
          const parts = action.key.toLowerCase().split('+');
          const key = parts.pop() || '';
          const modifiers = parts;
          await cliclick.sendHotkey(modifiers, key);
          return `Pressed key: ${action.key}`;
        }
        throw new Error('Key required for key action');
      }
      
      case 'scroll': {
        const direction = action.scroll_direction || 'down';
        const amount = action.scroll_amount || 3;
        await cliclick.scroll(direction, amount);
        return `Scrolled ${direction} by ${amount}`;
      }
      
      case 'left_click_drag': {
        if (action.start_coordinate && action.end_coordinate) {
          const [startX, startY] = action.start_coordinate;
          const [endX, endY] = action.end_coordinate;
          await cliclick.drag(startX, startY, endX, endY);
          return `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})`;
        }
        throw new Error('Start and end coordinates required for drag');
      }
      
      case 'wait': {
        const duration = action.duration || 1000;
        await cliclick.sleep(duration);
        return `Waited ${duration}ms`;
      }
      
      default:
        return `Unknown action: ${action.action}`;
    }
  }
}
