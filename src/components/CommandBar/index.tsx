import React, { useState, useRef, useCallback, useMemo } from 'react';
import { IoMdSend } from 'react-icons/io';
import { IoStopCircleSharp } from 'react-icons/io5';
import { hexToRgba } from './utils';
import { useAgentState } from './useAgentState';
import { useTheme } from './useTheme';
import { useCommandBarResize } from './useCommandBarResize';
import { useCommandBarEvents } from './useCommandBarEvents';
import { ToolApprovalView, AuthView, StatusView, ResponseView } from './AgentArea';

function CommandBar() {
  const [query, setQuery] = useState('');
  const [placeholder, setPlaceholder] = useState('...');
  const [selectedTextLength, setSelectedTextLength] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  const [agent, dispatch] = useAgentState();
  const { backgroundColor, opacity } = useTheme();

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const agentAreaRef = useRef<HTMLDivElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const toolApprovalRef = useRef<HTMLDivElement>(null);

  useCommandBarEvents(
    dispatch, inputRef, setSelectedTextLength, setPlaceholder,
    setIsVisible, setQuery, agent.isProcessing, agent.pendingToolApproval,
  );
  useCommandBarResize(inputRef, agentAreaRef, query, agent);

  const backgroundStyle = useMemo(
    () => hexToRgba(backgroundColor, opacity),
    [backgroundColor, opacity],
  );

  const handleSubmit = useCallback(async () => {
    if (!query.trim() || agent.isProcessing) return;

    dispatch({ type: 'START_PROCESSING' });

    try {
      dispatch({ type: 'SET_STATUS', payload: 'Extracting state...' });
      const result = await window.faria.agent.submit(query);
      if (result.success && result.result) {
        dispatch({ type: 'SET_RESPONSE', payload: result.result });
      } else if (result.error) {
        dispatch({ type: 'SET_RESPONSE', payload: `Error: ${result.error}` });
      }
    } catch (error) {
      dispatch({ type: 'SET_RESPONSE', payload: `Error: ${String(error)}` });
    }
  }, [query, agent.isProcessing]);

  const handleStop = useCallback(async () => {
    if (!agent.isProcessing) return;
    await window.faria.agent.cancel('stop-button-clicked');
    dispatch({ type: 'STOP_PROCESSING' });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [agent.isProcessing]);

  const handleOpenAuthUrl = useCallback(() => {
    if (!agent.pendingAuth) return;
    window.faria.shell.openExternal(agent.pendingAuth.redirectUrl);
  }, [agent.pendingAuth]);

  const handleAuthComplete = useCallback(() => {
    if (!agent.pendingAuth) return;
    dispatch({ type: 'CLEAR_AUTH' });
    window.faria.agent.authCompleted();
  }, [agent.pendingAuth]);

  const handleToolApprove = useCallback(() => {
    if (!agent.pendingToolApproval) return;
    dispatch({ type: 'CLEAR_TOOL_APPROVAL' });
    window.faria.agent.toolApprovalResponse(true);
  }, [agent.pendingToolApproval]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (agent.pendingToolApproval) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      window.faria.commandBar.hide();
    }
  }, [handleSubmit, agent.pendingToolApproval]);

  const handleCommandBarClick = useCallback(() => {
    window.faria.commandBar.refreshSelection().then((data) => {
      setSelectedTextLength(data.selectedTextLength);
    }).catch(() => {});
  }, []);

  const hasAgentContent = !!(agent.response || agent.streamingResponse || agent.errorMessage
    || agent.status || agent.pendingToolApproval || agent.pendingAuth);

  return (
    <div
      className="command-bar"
      style={{ background: backgroundStyle, visibility: isVisible ? 'visible' : 'hidden' }}
      onClick={handleCommandBarClick}
    >
      <div
        className={`command-bar-agent-area ${hasAgentContent ? 'has-content' : ''}`}
        ref={agentAreaRef}
      >
        {agent.pendingToolApproval ? (
          <ToolApprovalView
            approval={agent.pendingToolApproval}
            expanded={agent.toolApprovalExpanded}
            onToggleExpanded={() => dispatch({ type: 'TOGGLE_TOOL_EXPANDED' })}
            onApprove={handleToolApprove}
            toolApprovalRef={toolApprovalRef}
          />
        ) : agent.pendingAuth ? (
          <AuthView
            pendingAuth={agent.pendingAuth}
            onOpenUrl={handleOpenAuthUrl}
            onComplete={handleAuthComplete}
          />
        ) : agent.status ? (
          <StatusView status={agent.status} />
        ) : hasAgentContent ? (
          <ResponseView
            errorMessage={agent.errorMessage}
            response={agent.response}
            streamingResponse={agent.streamingResponse}
            responseRef={responseRef}
          />
        ) : null}
      </div>

      <div className="command-bar-input-row">
        <textarea
          ref={inputRef}
          className="command-bar-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={agent.isProcessing}
          rows={1}
        />
        <div className="input-actions">
          {selectedTextLength > 0 && (
            <span className="selection-indicator" title="Selected text">{selectedTextLength} chars</span>
          )}
          {agent.isProcessing ? (
            <button className="stop-button" onClick={handleStop} title="Stop">
              <IoStopCircleSharp />
            </button>
          ) : (
            <button
              className="send-button"
              onClick={handleSubmit}
              disabled={!query.trim()}
              title="Send message"
            >
              <IoMdSend />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandBar;
