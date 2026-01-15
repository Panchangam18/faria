import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { initDatabase } from '../../db/sqlite';
import { anthropicProvider } from './anthropic';
import { googleProvider } from './google';
import { ModelProvider, ModelConfig, ScreenDimensions, BoundModel } from './types';

export * from './types';

/**
 * All registered model providers
 */
const providers: ModelProvider[] = [
  anthropicProvider,
  googleProvider,
];

/**
 * Get the provider for a given model name
 */
export function getProvider(modelName: string): ModelProvider | null {
  return providers.find(p => p.supportsModel(modelName)) || null;
}

/**
 * Get the provider name for a model
 */
export function getProviderName(modelName: string): string {
  return getProvider(modelName)?.name || 'unknown';
}

/**
 * Get the selected model name from settings
 */
export function getSelectedModel(settingKey: string = 'selectedModel', defaultModel: string = 'claude-sonnet-4-20250514'): string {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey) as { value: string } | undefined;
  const model = row?.value || defaultModel;
  // Return "none" as-is, don't fallback to default
  if (row?.value === 'none') {
    return 'none';
  }
  return model;
}

/**
 * Create a model instance from a model name
 * This is the simple interface - just pass a model name and get a model back
 */
export function createModel(modelName: string, maxTokens: number = 4096): BaseChatModel | null {
  // Handle "none" model
  if (modelName === 'none') {
    console.log('[Models] Model is set to "none"');
    return null;
  }
  
  const provider = getProvider(modelName);
  if (!provider) {
    console.error(`[Models] No provider found for model: ${modelName}`);
    return null;
  }
  
  const model = provider.createModel({ model: modelName, maxTokens });
  if (model) {
    console.log(`[Models] Created ${provider.name} model: ${modelName}`);
  } else {
    console.log(`[Models] Failed to create ${provider.name} model (API key missing?)`);
  }
  
  return model;
}

/**
 * Create a model with computer use and other tools bound
 * Returns everything needed to invoke the model
 */
export function createModelWithTools(
  modelName: string,
  tools: unknown[],
  screenDimensions: ScreenDimensions,
  maxTokens: number = 4096
): BoundModel | null {
  // Handle "none" model
  if (modelName === 'none') {
    console.log('[Models] Model is set to "none"');
    return null;
  }
  
  const provider = getProvider(modelName);
  if (!provider) {
    console.error(`[Models] No provider found for model: ${modelName}`);
    return null;
  }
  
  const result = provider.createModelWithTools(
    { model: modelName, maxTokens },
    tools,
    screenDimensions
  );
  
  if (result) {
    console.log(`[Models] Created ${provider.name} model with tools: ${modelName}`);
  } else {
    console.log(`[Models] Failed to create ${provider.name} model (API key missing?)`);
  }
  
  return result;
}

/**
 * Check if a tool call is for computer use (handles both provider naming conventions)
 */
export function isComputerUseTool(toolName: string): boolean {
  return toolName === 'computer' || toolName === 'computer_use';
}

/**
 * Check if a provider supports computer use
 */
export function supportsComputerUse(modelName: string): boolean {
  const provider = getProvider(modelName);
  // Both Anthropic and Google support computer use
  return provider?.name === 'anthropic' || provider?.name === 'google';
}

/**
 * Get a human-readable display name for a tool
 */
export function getToolDisplayName(toolName: string): string {
  const names: Record<string, string> = {
    focus_app: 'Switching app',
    get_state: 'Checking state',
    computer: 'Using computer',
    computer_use: 'Using computer',
    run_applescript: 'Running AppleScript',
    search_tools: 'Searching tools',
    create_tool: 'Creating tool',
    chain_actions: 'Executing actions',
  };
  return names[toolName] || 'Taking action';
}

/**
 * Get the error message for a missing API key or None model
 */
export function getMissingKeyError(modelName: string): string {
  if (modelName === 'none') {
    return 'Model is set to None. Please choose a model in Settings.';
  }
  const provider = getProvider(modelName);
  const providerName = provider?.name === 'google' ? 'Google' : 'Anthropic';
  return `${providerName} API key not configured. Please add it in Settings.`;
}

/**
 * Result type for native SDK clients
 */
export type NativeClient = 
  | { provider: 'anthropic'; client: Anthropic; model: string }
  | { provider: 'google'; client: GoogleGenerativeAI; model: GenerativeModel; modelName: string };

/**
 * Create a native SDK client (not LangChain) for simpler use cases like inline agent
 * This gives direct access to Anthropic SDK or Google GenAI SDK
 */
export function createNativeClient(modelName: string): NativeClient | null {
  // Handle "none" model
  if (modelName === 'none') {
    console.log('[Models] Model is set to "none"');
    return null;
  }
  
  const db = initDatabase();
  const provider = getProvider(modelName);
  
  if (!provider) {
    console.error(`[Models] No provider found for model: ${modelName}`);
    return null;
  }
  
  if (provider.name === 'google') {
    const keyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('googleKey') as { value: string } | undefined;
    if (!keyRow?.value) {
      console.log('[Models] Google API key not configured');
      return null;
    }
    
    const client = new GoogleGenerativeAI(keyRow.value);
    const model = client.getGenerativeModel({ model: modelName });
    console.log(`[Models] Created native Google client for: ${modelName}`);
    return { provider: 'google', client, model, modelName };
  } else {
    const keyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('anthropicKey') as { value: string } | undefined;
    if (!keyRow?.value) {
      console.log('[Models] Anthropic API key not configured');
      return null;
    }
    
    const client = new Anthropic({ apiKey: keyRow.value });
    console.log(`[Models] Created native Anthropic client for: ${modelName}`);
    return { provider: 'anthropic', client, model: modelName };
  }
}

