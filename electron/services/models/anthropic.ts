import { ChatAnthropic } from '@langchain/anthropic';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ModelProvider, ModelConfig, BoundModel } from './types';
import { getAnthropicConfig } from '../proxy';

// Cache the base model instance to reuse HTTP/TLS connections across turns
let cachedModel: BaseChatModel | null = null;
let cachedModelKey: string | null = null; // "model:maxTokens:apiKey" composite key

/**
 * Anthropic (Claude) model provider
 */
export const anthropicProvider: ModelProvider = {
  name: 'anthropic',

  supportsModel(modelName: string): boolean {
    return modelName.startsWith('claude');
  },

  createModel(config: ModelConfig): BaseChatModel | null {
    const proxyConfig = getAnthropicConfig();

    const cacheKey = `${config.model}:${config.maxTokens}:${proxyConfig.apiKey}:${proxyConfig.baseURL || ''}`;
    if (cachedModel && cachedModelKey === cacheKey) {
      console.log(`[Models] Reusing cached Anthropic model: ${config.model}`);
      return cachedModel;
    }

    const model = new ChatAnthropic({
      model: config.model,
      anthropicApiKey: proxyConfig.apiKey,
      maxTokens: config.maxTokens,
      ...(proxyConfig.baseURL || proxyConfig.defaultHeaders ? {
        clientOptions: {
          ...(proxyConfig.baseURL ? { baseURL: proxyConfig.baseURL } : {}),
          ...(proxyConfig.defaultHeaders ? { defaultHeaders: proxyConfig.defaultHeaders } : {}),
        },
      } : {}),
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

export default anthropicProvider;

