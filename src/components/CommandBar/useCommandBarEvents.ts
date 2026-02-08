import { useEffect, MutableRefObject } from 'react';
import { AgentAction, PendingToolApproval } from './types';
import { PLACEHOLDER_TEXTS } from './utils';

function focusInput(inputRef: MutableRefObject<HTMLTextAreaElement | null>) {
  setTimeout(() => inputRef.current?.focus(), 0);
}

export function useCommandBarEvents(
  dispatch: React.Dispatch<AgentAction>,
  inputRef: MutableRefObject<HTMLTextAreaElement | null>,
  agentAreaRef: MutableRefObject<HTMLDivElement | null>,
  setSelectedTextLength: (n: number) => void,
  setPlaceholder: (s: string) => void,
  setIsVisible: (v: boolean) => void,
  setQuery: (q: string) => void,
  isProcessing: boolean,
  pendingToolApproval: PendingToolApproval | null,
) {
  // IPC event listeners
  useEffect(() => {
    const cleanupWillHide = window.faria.commandBar.onWillHide(() => {
      setIsVisible(false);
      setSelectedTextLength(0);
      dispatch({ type: 'ON_WILL_HIDE' });
      setPlaceholder('...');
    });

    const cleanupFocus = window.faria.commandBar.onFocus(() => {
      setPlaceholder(PLACEHOLDER_TEXTS[Math.floor(Math.random() * PLACEHOLDER_TEXTS.length)]);
      setIsVisible(true);
      inputRef.current?.focus();

      window.faria.commandBar.refreshSelection().then((data) => {
        setSelectedTextLength(data.selectedTextLength);
      }).catch(() => {});
    });

    const cleanupReady = window.faria.commandBar.onReady((data) => {
      setSelectedTextLength(data.selectedTextLength);
    });

    const cleanupStatus = window.faria.agent.onStatus((newStatus: string) => {
      dispatch({ type: 'SET_STATUS', payload: newStatus });
    });

    const cleanupChunk = window.faria.agent.onChunk((chunk: string) => {
      dispatch({ type: 'APPEND_CHUNK', payload: chunk });
    });

    const cleanupResponse = window.faria.agent.onResponse((newResponse: string) => {
      dispatch({ type: 'SET_RESPONSE', payload: newResponse });
      focusInput(inputRef);
    });

    const cleanupAuth = window.faria.agent.onAuthRequired((data) => {
      dispatch({ type: 'SET_AUTH_REQUIRED', payload: data });
    });

    const cleanupToolApproval = window.faria.agent.onToolApprovalRequired((data) => {
      dispatch({ type: 'SET_TOOL_APPROVAL', payload: data });
    });

    const cleanupError = window.faria.commandBar.onError((error) => {
      dispatch({ type: 'SET_ERROR', payload: error });
      focusInput(inputRef);
      setTimeout(() => {
        dispatch({ type: 'CLEAR_ERROR' });
      }, 3000);
    });

    const cleanupReset = window.faria.commandBar.onReset(() => {
      // Hide agent area synchronously via DOM before React re-renders,
      // so the window can resize without flashing stale content
      if (agentAreaRef.current) {
        agentAreaRef.current.classList.remove('has-content');
        agentAreaRef.current.style.maxHeight = '';
        agentAreaRef.current.style.opacity = '';
      }
      setQuery('');
      setSelectedTextLength(0);
      dispatch({ type: 'ON_RESET' });
    });

    return () => {
      cleanupWillHide();
      cleanupFocus();
      cleanupReady();
      cleanupStatus();
      cleanupChunk();
      cleanupResponse();
      cleanupAuth();
      cleanupToolApproval();
      cleanupError();
      cleanupReset();
    };
  }, []);

  // Global keyboard listener for Ctrl+C cancel and tool approval shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ctrl+C to cancel agent (not Cmd+C which is copy on macOS)
      if (e.key === 'c' && e.ctrlKey && !e.metaKey && isProcessing) {
        e.preventDefault();
        window.faria.agent.cancel('ctrl-c-pressed');
        dispatch({ type: 'ON_CANCEL' });
        focusInput(inputRef);
        return;
      }

      if (pendingToolApproval) {
        if (e.key === 'Enter') {
          e.preventDefault();
          dispatch({ type: 'CLEAR_TOOL_APPROVAL' });
          window.faria.agent.toolApprovalResponse(true);
        }
        if (e.key === 'Tab' && e.shiftKey && pendingToolApproval.details && Object.keys(pendingToolApproval.details).length > 0) {
          e.preventDefault();
          dispatch({ type: 'TOGGLE_TOOL_EXPANDED' });
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [pendingToolApproval, isProcessing]);
}
