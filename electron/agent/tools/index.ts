import { StateExtractor, AppState } from '../../services/state-extractor';

// Types
export type { ToolResult, ToolDefinition, ToolContext } from './types';
export { executeComputerAction, type ComputerAction, type ComputerActionResult } from './computer-use';

// Tool definitions
import { toolDefinitions } from './definitions';

// Tool implementations
import { focusApp } from './focus-app';
import { getState } from './get-state';
import { runAppleScriptTool } from './run-applescript';
import { chainActions } from './chain-actions';
import { webSearch } from './web-search';
import { insertImage } from './insert-image';
import { replaceSelectedText } from './replace-text';
import { executePython, ExecutePythonParams } from './execute-python';

import type { ToolResult, ToolContext } from './types';

/**
 * Tool Executor - handles execution of all built-in and custom tools
 */
export class ToolExecutor {
  private stateExtractor: StateExtractor;
  private currentState: AppState | null = null;
  private targetApp: string | null = null; // The app that was focused when command bar opened
  private provider: 'anthropic' | 'google' | null = null; // Which model provider is being used
  
  constructor(stateExtractor: StateExtractor) {
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
   * Set the model provider (for coordinate format handling)
   */
  setProvider(provider: 'anthropic' | 'google' | null): void {
    this.provider = provider;
    console.log(`[Faria] Tool executor provider set to: ${provider}`);
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
      stateExtractor: this.stateExtractor,
      currentState: this.currentState,
      targetApp: this.targetApp,
      provider: this.provider,
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
        case 'focus_app':
          return await focusApp(params as { name: string }, context);
        case 'get_state':
          return await getState(context);
        case 'run_applescript':
          return await runAppleScriptTool(params as { script: string });
        case 'chain_actions':
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return await chainActions(params as any, context);
        case 'web_search':
          return await webSearch(params as { query: string });
        case 'insert_image':
          return await insertImage(params as { query: string }, context);
        case 'replace_selected_text':
          return await replaceSelectedText(params as { text: string }, context);
        case 'execute_python':
          return await executePython(params as unknown as ExecutePythonParams);
        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}
