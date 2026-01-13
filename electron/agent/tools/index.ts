import { AppRegistry } from '../../services/app-registry';
import { StateExtractor, AppState } from '../../services/state-extractor';

// Types
export type { ToolResult, ToolDefinition, ToolContext } from './types';

// Tool definitions
import { toolDefinitions } from './definitions';

// Tool implementations
import { executeScript } from './execute-script';
import { sendKeystrokes } from './send-keystrokes';
import { sendHotkey } from './send-hotkey';
import { click } from './click';
import { scroll } from './scroll';
import { focusApp } from './focus-app';
import { getState } from './get-state';
import { findReplace } from './find-replace';
import { runAppleScriptTool } from './run-applescript';
import { runShell } from './run-shell';
import { searchTools } from './search-tools';
import { createTool } from './create-tool';
import { executeCustomTool } from './execute-custom-tool';
import { chainActions } from './chain-actions';

import type { ToolResult, ToolContext } from './types';

/**
 * Tool Executor - handles execution of all built-in and custom tools
 */
export class ToolExecutor {
  private appRegistry: AppRegistry;
  private stateExtractor: StateExtractor;
  private currentState: AppState | null = null;
  private targetApp: string | null = null; // The app that was focused when command bar opened
  
  constructor(appRegistry: AppRegistry, stateExtractor: StateExtractor) {
    this.appRegistry = appRegistry;
    this.stateExtractor = stateExtractor;
  }
  
  /**
   * Set the target app for actions (captured when command bar opens)
   */
  setTargetApp(appName: string | null): void {
    this.targetApp = appName;
    console.log(`[Faria] Tool executor target app set to: ${appName}`);
  }
  
  /**
   * Set the current state for element ID resolution
   */
  setCurrentState(state: AppState): void {
    this.currentState = state;
  }
  
  /**
   * Get all tool definitions for Claude
   */
  getToolDefinitions() {
    return toolDefinitions;
  }
  
  /**
   * Get the tool context for passing to individual tools
   */
  private getContext(): ToolContext {
    return {
      appRegistry: this.appRegistry,
      stateExtractor: this.stateExtractor,
      currentState: this.currentState,
      targetApp: this.targetApp,
      setCurrentState: (state: AppState) => {
        this.currentState = state;
      },
      setTargetApp: (appName: string | null) => {
        this.targetApp = appName;
        console.log(`[Faria] Target app updated to: ${appName}`);
      },
    };
  }
  
  /**
   * Execute a tool by name
   */
  async execute(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
    const context = this.getContext();
    
    try {
      switch (toolName) {
        case 'execute_script':
          return await executeScript(params as { app: string; code: string; language?: string }, context);
        case 'send_keystrokes':
          return await sendKeystrokes(params as { text: string }, context);
        case 'send_hotkey':
          return await sendHotkey(params as { modifiers?: string[]; key: string }, context);
        case 'click':
          return await click(params as { x: number; y: number }, context);
        case 'scroll':
          return await scroll(params as { direction: 'up' | 'down' | 'left' | 'right'; amount?: number });
        case 'focus_app':
          return await focusApp(params as { name: string }, context);
        case 'get_state':
          return await getState(context);
        case 'find_replace':
          return await findReplace(params as { find: string; replace: string });
        case 'run_applescript':
          return await runAppleScriptTool(params as { script: string });
        case 'run_shell':
          return await runShell(params as { command: string });
        case 'search_tools':
          return await searchTools(params as { query: string; type?: 'bm25' | 'grep' });
        case 'create_tool':
          return await createTool(params as { name: string; description: string; parameters: string; code: string });
        case 'chain_actions':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await chainActions(params as any, context);
        default:
          // Try custom tool
          return await executeCustomTool(toolName, params, context);
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}
