import { DynamicStructuredTool } from '@langchain/core/tools';
import { StateExtractor, AppState } from '../../services/state-extractor';
import type { ToolContext } from './types';

// Types
export type { ToolContext } from './types';

// Tool factory functions
import { createGetStateTool } from './get-state';
import { createChainActionsTool } from './computer-actions';
import { createWebSearchTool } from './web-search';
import { createInsertImageTool } from './insert-image';
import { createReplaceSelectedTextTool } from './replace-text';
import { createExecutePythonTool } from './execute-python';

/**
 * Tool Executor - handles execution of all built-in and custom tools
 */
export class ToolExecutor {
  private stateExtractor: StateExtractor;
  private currentState: AppState | null = null;
  private targetApp: string | null = null; // The app that was focused when command bar opened
  private provider: 'anthropic' | 'google' | null = null; // Which model provider is being used
  private pendingImages: string[] = [];
  
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
   * Add images captured during tool execution
   */
  addPendingImages(images: string[]): void {
    if (images.length === 0) return;
    this.pendingImages.push(...images);
  }

  /**
   * Consume and clear pending images
   */
  consumePendingImages(): string[] {
    const images = this.pendingImages.slice();
    this.pendingImages = [];
    return images;
  }
  
  /**
   * Set the current state for element ID resolution
   */
  setCurrentState(state: AppState): void {
    this.currentState = state;
  }
  
  /**
   * Get all built-in tools as DynamicStructuredTool instances
   * This creates tools with context baked in via closure
   */
  getTools(): DynamicStructuredTool[] {
    const context = this.getContext();

    return [
      createGetStateTool(context),
      createChainActionsTool(context),
      createWebSearchTool(),
      createInsertImageTool(context),
      createReplaceSelectedTextTool(context),
      createExecutePythonTool(),
    ];
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
      addPendingImages: (images: string[]) => {
        this.addPendingImages(images);
      },
      consumePendingImages: () => this.consumePendingImages(),
    };
  }
}
