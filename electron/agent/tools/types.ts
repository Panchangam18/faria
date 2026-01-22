import { StateExtractor, AppState } from '../../services/state-extractor';

// Legacy interfaces kept for backward compatibility in tool files
// These are still used by legacy functions but tools now return strings directly
export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required: string[];
  };
}

// ToolContext is still actively used for dependency injection
export interface ToolContext {
  stateExtractor: StateExtractor;
  currentState: AppState | null;
  targetApp: string | null;
  provider: 'anthropic' | 'google' | null;  // Which model provider is being used
  setCurrentState: (state: AppState) => void;
  setTargetApp: (appName: string | null) => void;
}

