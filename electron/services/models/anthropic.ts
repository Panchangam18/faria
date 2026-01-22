import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { initDatabase } from '../../db/sqlite';
import { ModelProvider, ModelConfig, BoundModel } from './types';

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
    tools: DynamicStructuredTool[]
  ): BoundModel | null {
    const model = this.createModel(config);
    if (!model) return null;

    // Bind tools using LangChain's native bindTools method
    const boundModel = model.bindTools!(tools);

    return {
      model: boundModel,
      invokeOptions: this.getInvokeOptions(),
    };
  },
  
  getInvokeOptions(): Record<string, unknown> {
    return {};
  },
};

export default anthropicProvider;

