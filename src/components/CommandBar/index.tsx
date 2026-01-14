import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { IoMdSend } from 'react-icons/io';

type Mode = 'agent' | 'inline';

const MODES = [
  { id: 'agent' as Mode, name: 'Agent', shortcut: '⌘↵' },
  { id: 'inline' as Mode, name: 'Inline', shortcut: '⌘↵' },
];

// Line height is 15px * 1.5 = 22.5px, round to 23px
const LINE_HEIGHT = 23;
const MAX_LINES = 10;
const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * MAX_LINES; // 230px for 10 lines
const BASE_HEIGHT = 80; // Footer + padding

function CommandBar() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [mode, setMode] = useState<Mode>('agent');
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [contextText, setContextText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Resize window based on textarea content - runs synchronously after DOM updates
  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    
    // Collapse to 0 to get true content height (no flexbox interference now)
    textarea.style.height = '0px';
    textarea.style.overflow = 'hidden';
    
    // Read the true content height
    const scrollHeight = textarea.scrollHeight;
    const contentHeight = Math.max(LINE_HEIGHT, Math.min(scrollHeight, MAX_TEXTAREA_HEIGHT));
    textarea.style.height = `${contentHeight}px`;
    
    // Only enable scrolling when content exceeds max height
    if (scrollHeight > MAX_TEXTAREA_HEIGHT) {
      textarea.style.overflow = 'auto';
      textarea.classList.add('scrollable');
    } else {
      textarea.classList.remove('scrollable');
    }
    
    // Calculate and set window height
    const totalHeight = BASE_HEIGHT + contentHeight + (response ? 100 : 0);
    window.faria.commandBar.resize(totalHeight);
  }, [query, response]);

  useEffect(() => {
    // Focus input when command bar becomes visible
    window.faria.commandBar.onFocus(() => {
      inputRef.current?.focus();
    });

    // Listen for mode changes from main process
    window.faria.commandBar.onModeChange((newMode: Mode, context?: string) => {
      setMode(newMode);
      if (context) {
        setContextText(context);
      }
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

    // Listen for inline status updates
    window.faria.commandBar.onInlineStatus((newStatus: string) => {
      setStatus(newStatus);
    });

    // Listen for inline response
    window.faria.commandBar.onInlineResponse((newResponse: string) => {
      setResponse(newResponse);
      setIsProcessing(false);
      setStatus('');
    });

    // Listen for edit applied - silently complete, the edit speaks for itself
    window.faria.commandBar.onEditApplied(() => {
      setIsProcessing(false);
      setStatus('');
    });
  }, []);

  // Handle mode switching via keyboard shortcut
  const switchMode = useCallback((newMode: Mode) => {
    if (isProcessing) return;
    setMode(newMode);
    window.faria.commandBar.setMode(newMode);
  }, [isProcessing]);

  const handleSubmit = useCallback(async () => {
    if (!query.trim() || isProcessing) return;

    setIsProcessing(true);
    setResponse('');

    try {
      if (mode === 'agent') {
        setStatus('Extracting state...');
        const result = await window.faria.agent.submit(query);
        if (result.success && result.result) {
          setResponse(result.result);
          // Add to history
          await window.faria.history.add(query, result.result);
        } else if (result.error) {
          setResponse(`Error: ${result.error}`);
        }
      } else {
        // Inline mode
        setStatus('Thinking...');
        const result = await window.faria.commandBar.submitInline(query, contextText);
        if (result.success && result.result) {
          setResponse(result.result);
        } else if (result.error) {
          setResponse(`Error: ${result.error}`);
        }
      }
    } catch (error) {
      setResponse(`Error: ${String(error)}`);
    } finally {
      setIsProcessing(false);
      setStatus('');
    }
  }, [query, isProcessing, mode, contextText]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      window.faria.commandBar.hide();
    }
    // Mode switching shortcut: Cmd+Enter to toggle between modes
    if (e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      switchMode(mode === 'agent' ? 'inline' : 'agent');
    }
  }, [handleSubmit, switchMode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuery(e.target.value);
    // Resizing is handled by useLayoutEffect when query changes
  };

  const currentMode = MODES.find(m => m.id === mode) || MODES[0];
  const placeholder = mode === 'agent' ? 'Take action...' : 'Edit or ask about selection...';

  return (
    <div className="command-bar">
      <div className="command-bar-input-area">
        <textarea
          ref={inputRef}
          className="command-bar-input"
          placeholder={placeholder}
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
        <div className="footer-left"></div>
        <div className="footer-right">
          {/* Mode selector */}
          <div className="mode-selector">
            <button
              className="mode-selector-trigger"
              onClick={() => setShowModeMenu(!showModeMenu)}
              disabled={isProcessing}
            >
              <span>{currentMode.name}</span>
              <svg className={`chevron ${showModeMenu ? 'open' : ''}`} viewBox="0 0 10 6" fill="none">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            
            {showModeMenu && (
              <div className="mode-selector-menu">
                {MODES.map((m) => (
                  <div
                    key={m.id}
                    className={`mode-option ${m.id === mode ? 'active' : ''}`}
                    onClick={() => {
                      switchMode(m.id);
                      setShowModeMenu(false);
                    }}
                  >
                    <span className="mode-name">{m.name}</span>
                    <span className="mode-shortcut">{m.shortcut}</span>
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
<IoMdSend />
          </button>
        </div>
      </div>
    </div>
  );
}

export default CommandBar;
