import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { initDatabase } from '../../db/sqlite';
import { ModelProvider, ModelConfig, ScreenDimensions, BoundModel } from './types';

/**
 * Anthropic (Claude) model provider
 */
export const anthropicProvider: ModelProvider = {
  name: 'anthropic',
  
  supportsModel(modelName: string): boolean {
    return modelName.startsWith('claude');
  },
  
  createModel(config: ModelConfig): BaseChatModel | null {
    const db = initDatabase();
    const keyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('anthropicKey') as { value: string } | undefined;
    
    if (!keyRow?.value) {
      return null;
    }
    
    return new ChatAnthropic({
      model: config.model,
      anthropicApiKey: keyRow.value,
      maxTokens: config.maxTokens,
    });
  },
  
  createModelWithTools(
    config: ModelConfig,
    tools: unknown[],
    screenDimensions: ScreenDimensions
  ): BoundModel | null {
    const model = this.createModel(config);
    if (!model) return null;
    
    // Anthropic's computer use tool format (beta)
    const computerTool = {
      type: 'computer_20250124' as const,
      name: 'computer',
      display_width_px: screenDimensions.width,
      display_height_px: screenDimensions.height,
    };
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boundModel = model.bindTools!([...tools, computerTool] as any);
    
    return {
      model: boundModel,
      invokeOptions: this.getInvokeOptions(),
      computerToolName: 'computer',
    };
  },
  
  getInvokeOptions(): Record<string, unknown> {
    return {
      // Use latest computer use beta (matches computer_20250124 tool version)
      betas: ['computer-use-2025-01-24'],
    };
  },
};

export default anthropicProvider;

