import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { initDatabase } from '../../db/sqlite';
import { ModelProvider, ModelConfig, ScreenDimensions, BoundModel } from './types';

/**
 * Google (Gemini) model provider
 */
export const googleProvider: ModelProvider = {
  name: 'google',
  
  supportsModel(modelName: string): boolean {
    return modelName.startsWith('gemini');
  },
  
  createModel(config: ModelConfig): BaseChatModel | null {
    const db = initDatabase();
    const keyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('googleKey') as { value: string } | undefined;
    
    if (!keyRow?.value) {
      return null;
    }
    
    return new ChatGoogleGenerativeAI({
      model: config.model,
      apiKey: keyRow.value,
      maxOutputTokens: config.maxTokens,
    });
  },
  
  createModelWithTools(
    config: ModelConfig,
    tools: DynamicStructuredTool[],
    _screenDimensions: ScreenDimensions
  ): BoundModel | null {
    const model = this.createModel(config);
    if (!model) return null;

    // Google's computer use tool format (from LangChain Python docs)
    // Bind it alongside regular tools
    const computerTool = { computer_use: {} };

    // Bind tools using LangChain's native bindTools method
    // Type assertion needed only for the computer tool (custom format for Google)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const boundModel = model.bindTools!([...tools, computerTool as any]);

    return {
      model: boundModel,
      invokeOptions: this.getInvokeOptions(),
      computerToolName: 'computer_use',
    };
  },
  
  getInvokeOptions(): Record<string, unknown> {
    return {};
  },
};

export default googleProvider;

