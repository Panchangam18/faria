import { useReducer } from 'react';
import { AgentState, AgentAction } from './types';

export const INITIAL_AGENT_STATE: AgentState = {
  response: '',
  streamingResponse: '',
  status: '',
  isProcessing: false,
  pendingAuth: null,
  pendingToolApproval: null,
  toolApprovalExpanded: false,
  errorMessage: null,
};

function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, status: action.payload };

    case 'APPEND_CHUNK':
      return { ...state, streamingResponse: state.streamingResponse + action.payload };

    case 'SET_RESPONSE':
      return {
        ...state,
        response: action.payload,
        streamingResponse: '',
        isProcessing: false,
        status: '',
        pendingAuth: null,
        pendingToolApproval: null,
      };

    case 'START_PROCESSING':
      return {
        ...state,
        isProcessing: true,
        response: '',
        streamingResponse: '',
      };

    case 'SET_ERROR':
      return {
        ...state,
        errorMessage: action.payload,
        response: `Error: ${action.payload}`,
        isProcessing: false,
        status: '',
        pendingAuth: null,
      };

    case 'CLEAR_ERROR':
      return { ...state, errorMessage: null, response: '' };

    case 'SET_AUTH_REQUIRED':
      return {
        ...state,
        pendingAuth: action.payload,
        status: `Waiting for ${action.payload.toolkit} authentication...`,
      };

    case 'CLEAR_AUTH':
      return { ...state, pendingAuth: null, status: 'Resuming...' };

    case 'SET_TOOL_APPROVAL':
      return {
        ...state,
        pendingToolApproval: action.payload,
        toolApprovalExpanded: false,
        status: 'Waiting for approval...',
      };

    case 'CLEAR_TOOL_APPROVAL':
      return { ...state, pendingToolApproval: null, status: 'Executing...' };

    case 'TOGGLE_TOOL_EXPANDED':
      return { ...state, toolApprovalExpanded: !state.toolApprovalExpanded };

    case 'STOP_PROCESSING':
    case 'ON_CANCEL':
      return {
        ...state,
        isProcessing: false,
        status: '',
        pendingAuth: null,
        pendingToolApproval: null,
        toolApprovalExpanded: false,
      };

    case 'ON_WILL_HIDE':
      return { ...state, streamingResponse: '', errorMessage: null };

    case 'ON_RESET':
      return { ...INITIAL_AGENT_STATE };

    default:
      return state;
  }
}

export function useAgentState() {
  return useReducer(agentReducer, INITIAL_AGENT_STATE);
}
