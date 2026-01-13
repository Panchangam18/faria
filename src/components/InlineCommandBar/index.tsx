import React, { useState, useEffect, useRef, useCallback } from 'react';

function InlineCommandBar() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [contextText, setContextText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input when inline bar becomes visible
    window.faria.inlineBar.onFocus(() => {
      inputRef.current?.focus();
    });

    // Receive the text context extracted around the cursor
    window.faria.inlineBar.onContext((context: string) => {
      setContextText(context);
    });

    // Listen for status updates from inline agent
    window.faria.inlineBar.onStatus((newStatus: string) => {
      setStatus(newStatus);
    });

    // Listen for response from inline agent
    window.faria.inlineBar.onResponse((newResponse: string) => {
      setResponse(newResponse);
      setIsProcessing(false);
      setStatus('');
    });

    // Listen for edits being applied
    window.faria.inlineBar.onEditApplied(() => {
      setStatus('Done!');
      setIsProcessing(false);
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!query.trim() || isProcessing) return;

    setIsProcessing(true);
    setStatus('Thinking...');
    setResponse('');

    try {
      const result = await window.faria.inlineBar.submit(query, contextText);
      if (result.success && result.result) {
        setResponse(result.result);
      } else if (result.error) {
        setResponse(`Error: ${result.error}`);
      }
    } catch (error) {
      setResponse(`Error: ${String(error)}`);
    } finally {
      setIsProcessing(false);
      setStatus('');
    }
  }, [query, contextText, isProcessing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      window.faria.inlineBar.hide();
    }
  }, [handleSubmit]);

  return (
    <div className="inline-bar">
      <div className="inline-bar-icon">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M12 3L20 7.5V16.5L12 21L4 16.5V7.5L12 3Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      
      <input
        ref={inputRef}
        className="inline-bar-input"
        placeholder="Edit or ask about selection..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isProcessing}
      />

      {status && (
        <div className="inline-bar-status">
          <div className="status-dot" />
        </div>
      )}

      {response && !isProcessing && (
        <div className="inline-bar-response">
          {response.length > 50 ? response.slice(0, 50) + '...' : response}
        </div>
      )}

      <button
        className="inline-bar-send"
        onClick={handleSubmit}
        disabled={!query.trim() || isProcessing}
      >
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12H19M19 12L12 5M19 12L12 19"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

export default InlineCommandBar;

