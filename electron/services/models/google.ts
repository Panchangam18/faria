import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ModelProvider, ModelConfig, BoundModel } from './types';
import { getGoogleConfig } from '../proxy';

// Cache the base model instance to reuse HTTP/TLS connections across turns
let cachedModel: BaseChatModel | null = null;
let cachedModelKey: string | null = null; // "model:maxTokens:apiKey" composite key

/**
 * Google (Gemini) model provider
 */
export const googleProvider: ModelProvider = {
  name: 'google',

  supportsModel(modelName: string): boolean {
    return modelName.startsWith('gemini');
  },

  async createModel(config: ModelConfig): Promise<BaseChatModel | null> {
    const proxyConfig = await getGoogleConfig();

    const cacheKey = `${config.model}:${config.maxTokens}:${proxyConfig.apiKey}:${proxyConfig.baseURL || ''}`;
    if (cachedModel && cachedModelKey === cacheKey) {
      console.log(`[Models] Reusing cached Google model: ${config.model}`);
      return cachedModel;
    }

    const model = new ChatGoogleGenerativeAI({
      model: config.model,
      apiKey: proxyConfig.apiKey,
      maxOutputTokens: config.maxTokens,
      ...(proxyConfig.baseURL ? { baseUrl: proxyConfig.baseURL } : {}),
      ...(proxyConfig.defaultHeaders ? { customHeaders: proxyConfig.defaultHeaders } : {}),
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

export default googleProvider;
