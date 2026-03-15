import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { initDatabase } from '../../db/sqlite';
import { ModelProvider, ModelConfig, BoundModel } from './types';

// Cache the base model instance to reuse HTTP/TLS connections across turns
let cachedModel: BaseChatModel | null = null;
let cachedModelKey: string | null = null; // "model:maxTokens:apiKey" composite key

/**
 * OpenAI model provider
 */
export const openaiProvider: ModelProvider = {
  name: 'openai',

  supportsModel(modelName: string): boolean {
    return modelName.startsWith('gpt-5');
  },

  createModel(config: ModelConfig): BaseChatModel | null {
    const db = initDatabase();
    const keyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('openaiKey') as { value: string } | undefined;

    if (!keyRow?.value) {
      return null;
    }

    const cacheKey = `${config.model}:${config.maxTokens}:${keyRow.value}`;
    if (cachedModel && cachedModelKey === cacheKey) {
      console.log(`[Models] Reusing cached OpenAI model: ${config.model}`);
      return cachedModel;
    }

    const model = new ChatOpenAI({
      model: config.model,
      apiKey: keyRow.value,
      maxTokens: config.maxTokens,
    });

    cachedModel = model;
    cachedModelKey = cacheKey;
    return model;
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

export default openaiProvider;
