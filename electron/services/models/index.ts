import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DynamicStructuredTool } from '@langchain/core/tools';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { initDatabase } from '../../db/sqlite';
import { anthropicProvider } from './anthropic';
import { googleProvider } from './google';
import { ModelProvider, ModelConfig, BoundModel } from './types';

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
 * Get a boolean setting value
 */
export function getBooleanSetting(settingKey: string, defaultValue: boolean = true): boolean {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey) as { value: string } | undefined;
  if (row?.value === undefined || row?.value === null) {
    return defaultValue;
  }
  return row.value === 'true';
}

/**
 * Tool setting type: 'enabled' | 'disabled' | 'auto-approve'
 */
export type ToolSetting = 'enabled' | 'disabled' | 'auto-approve';

/**
 * Tool settings configuration
 */
export interface ToolSettings {
  screenshot: ToolSetting;
  typing: ToolSetting;
  replaceText: ToolSetting;
  insertImage: ToolSetting;
  clicking: ToolSetting;
  scrolling: ToolSetting;
  integrations: ToolSetting;
}

/**
 * Default tool settings
 */
const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  screenshot: 'enabled',
  typing: 'enabled',
  replaceText: 'enabled',
  insertImage: 'enabled',
  clicking: 'enabled',
  scrolling: 'enabled',
  integrations: 'enabled',
};

/**
 * Get tool settings from database
 */
export function getToolSettings(): ToolSettings {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('toolSettings') as { value: string } | undefined;
  if (!row?.value) {
    return DEFAULT_TOOL_SETTINGS;
  }
  try {
    const parsed = JSON.parse(row.value);
    return { ...DEFAULT_TOOL_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_TOOL_SETTINGS;
  }
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
 * Create a model with tools bound
 * Returns everything needed to invoke the model
 */
export function createModelWithTools(
  modelName: string,
  tools: DynamicStructuredTool[],
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
    tools
  );
  
  if (result) {
    console.log(`[Models] Created ${provider.name} model with tools: ${modelName}`);
  } else {
    console.log(`[Models] Failed to create ${provider.name} model (API key missing?)`);
  }
  
  return result;
}

/**
 * Get a human-readable display name for a tool
 */
export function getToolDisplayName(toolName: string): string {
  // Built-in tools
  const names: Record<string, string> = {
    get_state: 'Checking state',
    search_tools: 'Searching tools',
    create_tool: 'Creating tool',
    computer_actions: 'Executing actions',
    web_search: 'Searching the web',
    insert_image: 'Inserting image',
    replace_selected_text: 'Replacing text',
    execute_bash: 'Running command',
    // Composio meta-tools (hidden from user as "Composio")
    COMPOSIO_SEARCH_TOOLS: 'Searching integrations',
    COMPOSIO_MANAGE_CONNECTIONS: 'Checking connections',
  };

  if (names[toolName]) {
    return names[toolName];
  }

  // Handle any COMPOSIO_ prefixed tools we haven't explicitly named
  if (toolName.startsWith('COMPOSIO_')) {
    const actionParts = toolName.replace('COMPOSIO_', '').split('_');
    const actionVerb = actionParts[0]?.toLowerCase() || '';
    const actionRest = actionParts.slice(1).join(' ').toLowerCase();

    // Convert verb to present participle
    let verb = actionVerb;
    if (actionVerb === 'multi') {
      return 'Executing actions';
    } else if (actionVerb === 'execute') {
      return 'Executing ' + actionRest;
    } else if (actionVerb.endsWith('e')) {
      verb = actionVerb.slice(0, -1) + 'ing';
    } else if (actionVerb === 'get') {
      verb = 'Getting';
    } else if (actionVerb === 'search') {
      verb = 'Searching';
    } else if (actionVerb === 'list') {
      verb = 'Listing';
    } else {
      verb = actionVerb + 'ing';
    }

    verb = verb.charAt(0).toUpperCase() + verb.slice(1);
    return `${verb}${actionRest ? ' ' + actionRest : ''}`;
  }

  // Handle Composio toolkit tools (e.g., GMAIL_SEND_EMAIL, GITHUB_STAR_REPO)
  if (toolName.includes('_') && toolName === toolName.toUpperCase()) {
    const parts = toolName.split('_');
    const toolkit = parts[0];
    const actionParts = parts.slice(1);

    // Format toolkit name (GMAIL → Gmail, GITHUB → GitHub)
    const formattedToolkit = toolkit.charAt(0) + toolkit.slice(1).toLowerCase();

    // Format action (SEND_EMAIL → Sending email, STAR_REPO → Starring repo)
    const actionVerb = actionParts[0]?.toLowerCase() || '';
    const actionRest = actionParts.slice(1).join(' ').toLowerCase();

    // Convert verb to present participle (-ing form)
    let verb = actionVerb;
    if (actionVerb.endsWith('e')) {
      verb = actionVerb.slice(0, -1) + 'ing'; // create → creating
    } else if (actionVerb === 'get' || actionVerb === 'set') {
      verb = actionVerb + 'ting'; // get → getting
    } else if (actionVerb === 'star') {
      verb = 'starring';
    } else if (actionVerb === 'list') {
      verb = 'listing';
    } else if (actionVerb === 'fetch') {
      verb = 'fetching';
    } else if (actionVerb === 'search') {
      verb = 'searching';
    } else if (actionVerb === 'add') {
      verb = 'adding';
    } else if (actionVerb === 'update') {
      verb = 'updating';
    } else if (actionVerb === 'delete') {
      verb = 'deleting';
    } else if (actionVerb === 'remove') {
      verb = 'removing';
    } else {
      verb = actionVerb + 'ing';
    }

    // Capitalize first letter of verb
    verb = verb.charAt(0).toUpperCase() + verb.slice(1);

    return `${formattedToolkit}: ${verb}${actionRest ? ' ' + actionRest : ''}`;
  }

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

