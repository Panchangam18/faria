export interface PendingAuth {
  toolkit: string;
  redirectUrl: string;
}

export interface PendingToolApproval {
  toolName: string;
  toolDescription: string;
  args: Record<string, unknown>;
  isComposio: boolean;
  displayName?: string;
  details?: Record<string, string>;
}

export interface AgentState {
  response: string;
  streamingResponse: string;
  status: string;
  isProcessing: boolean;
  pendingAuth: PendingAuth | null;
  pendingToolApproval: PendingToolApproval | null;
  toolApprovalExpanded: boolean;
  errorMessage: string | null;
}

export type AgentAction =
  | { type: 'SET_STATUS'; payload: string }
  | { type: 'APPEND_CHUNK'; payload: string }
  | { type: 'SET_RESPONSE'; payload: string }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'SET_AUTH_REQUIRED'; payload: PendingAuth }
  | { type: 'CLEAR_AUTH' }
  | { type: 'SET_TOOL_APPROVAL'; payload: PendingToolApproval }
  | { type: 'CLEAR_TOOL_APPROVAL' }
  | { type: 'TOGGLE_TOOL_EXPANDED' }
  | { type: 'START_PROCESSING' }
  | { type: 'STOP_PROCESSING' }
  | { type: 'ON_WILL_HIDE' }
  | { type: 'ON_RESET' }
  | { type: 'ON_CANCEL' };
