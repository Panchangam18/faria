import { AppRegistry } from '../../services/app-registry';
import { StateExtractor, AppState } from '../../services/state-extractor';

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

export interface ToolContext {
  appRegistry: AppRegistry;
  stateExtractor: StateExtractor;
  currentState: AppState | null;
  targetApp: string | null;
  setCurrentState: (state: AppState) => void;
}

