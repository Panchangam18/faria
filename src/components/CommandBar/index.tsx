import React, { useState, useEffect, useRef, useCallback } from 'react';

const MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
];

function CommandBar() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODELS[0]);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus input when command bar becomes visible
    window.faria.commandBar.onFocus(() => {
      inputRef.current?.focus();
    });

    // Listen for status updates from agent
    window.faria.agent.onStatus((newStatus: string) => {
      setStatus(newStatus);
    });

    // Listen for response from agent
    window.faria.agent.onResponse((newResponse: string) => {
      setResponse(newResponse);
      setIsProcessing(false);
      setStatus('');
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!query.trim() || isProcessing) return;

    setIsProcessing(true);
    setStatus('Extracting state...');
    setResponse('');

    try {
      const result = await window.faria.agent.submit(query);
      if (result.success && result.result) {
        setResponse(result.result);
        // Add to history
        await window.faria.history.add(query, result.result);
      } else if (result.error) {
        setResponse(`Error: ${result.error}`);
      }
    } catch (error) {
      setResponse(`Error: ${String(error)}`);
    } finally {
      setIsProcessing(false);
      setStatus('');
    }
  }, [query, isProcessing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      window.faria.commandBar.hide();
    }
  }, [handleSubmit]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuery(e.target.value);
    // Auto-resize
    const textarea = e.target;
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 150);
    textarea.style.height = `${newHeight}px`;
    
    // Resize window to fit content
    const totalHeight = 80 + newHeight + (response ? 100 : 0);
    window.faria.commandBar.resize(totalHeight);
  };

  return (
    <div className="command-bar">
      <div className="command-bar-input-area">
        <textarea
          ref={inputRef}
          className="command-bar-input"
          placeholder="Ask Faria..."
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={isProcessing}
          rows={1}
        />
      </div>

      {response && (
        <div className="command-bar-response">
          {response}
        </div>
      )}

      {status && (
        <div className="command-bar-status">
          <div className="status-spinner" />
          <span>{status}</span>
        </div>
      )}

      <div className="command-bar-footer">
        <div className="model-selector">
          <button
            className="model-selector-trigger"
            onClick={() => setShowModelMenu(!showModelMenu)}
            disabled={isProcessing}
          >
            <span>{selectedModel.name}</span>
            <svg className={`chevron ${showModelMenu ? 'open' : ''}`} viewBox="0 0 10 6" fill="none">
              <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          
          {showModelMenu && (
            <div className="model-selector-menu">
              {MODELS.map((model) => (
                <div
                  key={model.id}
                  className={`model-option ${model.id === selectedModel.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedModel(model);
                    setShowModelMenu(false);
                  }}
                >
                  {model.name}
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          className="send-button"
          onClick={handleSubmit}
          disabled={!query.trim() || isProcessing}
          title="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default CommandBar;

