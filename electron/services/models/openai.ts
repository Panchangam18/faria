import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ModelProvider, ModelConfig, BoundModel } from './types';
import { getOpenAIConfig } from '../proxy';

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

  async createModel(config: ModelConfig): Promise<BaseChatModel | null> {
    const proxyConfig = await getOpenAIConfig();

    const cacheKey = `${config.model}:${config.maxTokens}:${proxyConfig.apiKey}:${proxyConfig.baseURL || ''}`;
    if (cachedModel && cachedModelKey === cacheKey) {
      console.log(`[Models] Reusing cached OpenAI model: ${config.model}`);
      return cachedModel;
    }

    const model = new ChatOpenAI({
      model: config.model,
      apiKey: proxyConfig.apiKey,
      maxTokens: config.maxTokens,
      configuration: {
        ...(proxyConfig.baseURL ? { baseURL: proxyConfig.baseURL } : {}),
        ...(proxyConfig.defaultHeaders ? { defaultHeaders: proxyConfig.defaultHeaders } : {}),
      },
    });

    cachedModel = model;
    cachedModelKey = cacheKey;
    return model;
  },

  async createModelWithTools(
    config: ModelConfig,
    tools: DynamicStructuredTool[]
  ): Promise<BoundModel | null> {
    const model = await this.createModel(config);
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
