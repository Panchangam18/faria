import { DynamicStructuredTool } from '@langchain/core/tools';
import { StateExtractor, AppState } from '../../services/state-extractor';
import type { ToolContext } from './types';
import type { ToolSettings } from '../../services/models';

// Types
export type { ToolContext } from './types';

// Tool factory functions
import { createGetStateTool } from './get-state';
import { createChainActionsTool } from './computer-actions';
import { createWebSearchTool } from './web-search';
import { createReplaceSelectedTextTool } from './replace-text';
import { createExecutePythonTool } from './execute-python';
import { createExecuteBashTool } from './execute-bash';
import { createReadFileTool } from './read-file';
import { createWriteFileTool } from './write-file';
import { createEditFileTool } from './edit-file';

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
   * @param toolSettings - configuration for which tools are enabled/disabled
   */
  getTools(toolSettings: ToolSettings): DynamicStructuredTool[] {
    const context = this.getContext();

    const tools: DynamicStructuredTool[] = [
      // createGetStateTool(context), // Disabled: returns "Unknown" for most apps, wastes a turn
      createChainActionsTool(context, toolSettings),
      createWebSearchTool(),
      // createExecutePythonTool(), // Removed: write_file + execute_bash covers this without sandbox restrictions
      createExecuteBashTool(),
      createReadFileTool(),
      createWriteFileTool(),
      createEditFileTool(),
    ];

    // Only include replace_selected_text if not disabled
    if (toolSettings.replaceText !== 'disabled') {
      tools.push(createReplaceSelectedTextTool(context));
    }

    return tools;
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
