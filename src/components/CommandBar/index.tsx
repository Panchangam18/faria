import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { IoMdSend } from 'react-icons/io';
import { IoStopCircleSharp } from 'react-icons/io5';

type Mode = 'agent' | 'inline';

const MODES = [
  { id: 'agent' as Mode, name: 'Agent', shortcut: '⌘↵' },
  { id: 'inline' as Mode, name: 'Inline', shortcut: '⌘↵' },
];

// Line height is 14px (font-size-sm) * 1.5 = 21px
const LINE_HEIGHT = 21;
const MAX_LINES = 5;
const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * MAX_LINES; // 115px for 5 lines
const BASE_HEIGHT = 46; // Footer + padding (8px top input + 2px bottom input + 4px top footer + 8px bottom footer + ~24px footer content)
const MAX_RESPONSE_HEIGHT = 200; // Max height before scrolling kicks in

function CommandBar() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [mode, setMode] = useState<Mode>('agent');
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [contextText, setContextText] = useState('');
  const [modelAvailability, setModelAvailability] = useState<{ agentAvailable: boolean; inlineAvailable: boolean }>({ agentAvailable: true, inlineAvailable: true });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const modeSelectorRef = useRef<HTMLDivElement>(null);

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
    
    // Clear inline overflow style so CSS class can control it
    textarea.style.overflow = '';
    
    // Only enable scrolling when content exceeds max height
    if (scrollHeight > MAX_TEXTAREA_HEIGHT) {
      textarea.classList.add('scrollable');
    } else {
      textarea.classList.remove('scrollable');
    }
    
    // Calculate response height (actual content height, capped at max)
    let responseHeight = 0;
    if (response && responseRef.current) {
      // Temporarily remove max-height to measure true content height
      const el = responseRef.current;
      const originalMaxHeight = el.style.maxHeight;
      el.style.maxHeight = 'none';
      const actualHeight = el.scrollHeight;
      el.style.maxHeight = originalMaxHeight;
      responseHeight = Math.min(actualHeight, MAX_RESPONSE_HEIGHT) + 16; // +16 for margin
    }
    
    // Calculate and set window height
    const totalHeight = BASE_HEIGHT + contentHeight + responseHeight;
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

    // Listen for model availability updates
    window.faria.commandBar.onModelAvailability((availability) => {
      setModelAvailability(availability);
    });

    // Listen for error messages
    window.faria.commandBar.onError((error) => {
      setErrorMessage(error);
      setResponse(`Error: ${error}`);
      setIsProcessing(false);
      setStatus('');
      // Clear error after 3 seconds
      setTimeout(() => {
        setErrorMessage(null);
        setResponse('');
      }, 3000);
    });
  }, []);

  // Handle mode switching via keyboard shortcut
  const switchMode = useCallback((newMode: Mode) => {
    if (isProcessing) return;
    // Check if the target mode is available
    if (newMode === 'agent' && !modelAvailability.agentAvailable) return;
    if (newMode === 'inline' && !modelAvailability.inlineAvailable) return;
    setMode(newMode);
    window.faria.commandBar.setMode(newMode);
  }, [isProcessing, modelAvailability]);

  // Determine if mode switching is allowed
  const canSwitchModes = modelAvailability.agentAvailable && modelAvailability.inlineAvailable;

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showModeMenu && modeSelectorRef.current && !modeSelectorRef.current.contains(e.target as Node)) {
        setShowModeMenu(false);
        window.faria.commandBar.setDropdownVisible(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showModeMenu]);

  // Add/remove dropdown-open class on root element
  useEffect(() => {
    const root = document.getElementById('root');
    if (root) {
      if (showModeMenu) {
        root.classList.add('dropdown-open');
      } else {
        root.classList.remove('dropdown-open');
      }
    }
  }, [showModeMenu]);

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
    // Mode switching shortcut: Cmd+Enter to toggle between modes
    // Check this FIRST to prevent submitting when switching modes
    if (e.metaKey && e.key === 'Enter') {
      e.preventDefault();
      switchMode(mode === 'agent' ? 'inline' : 'agent');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      // Close dropdown first if open, otherwise hide command bar
      if (showModeMenu) {
        setShowModeMenu(false);
        window.faria.commandBar.setDropdownVisible(false);
      } else {
        window.faria.commandBar.hide();
      }
    }
  }, [handleSubmit, switchMode, showModeMenu, mode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuery(e.target.value);
    // Resizing is handled by useLayoutEffect when query changes
  };

  const handleStop = useCallback(async () => {
    if (!isProcessing) return;
    await window.faria.agent.cancel();
    setIsProcessing(false);
    setStatus('');
  }, [isProcessing]);

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

      {(response || errorMessage) && (
        <div className="command-bar-response" ref={responseRef} style={errorMessage ? { color: 'var(--color-error, #ff4444)' } : undefined}>
          {errorMessage || response}
        </div>
      )}

      <div className="command-bar-footer">
        <div className="footer-left">
          {status && (
            <div className="command-bar-status">
              <div className="status-spinner" />
              <span>{status}</span>
            </div>
          )}
        </div>
        <div className="footer-right">
          {/* Mode selector - only show if both models are available */}
          {canSwitchModes && (
            <>
              <span className="mode-shortcut-hint">⌘↵</span>
              <div className="mode-selector" ref={modeSelectorRef}>
                <button
                  className="mode-selector-trigger"
                  onClick={() => {
                    const newState = !showModeMenu;
                    setShowModeMenu(newState);
                    window.faria.commandBar.setDropdownVisible(newState);
                  }}
                  disabled={isProcessing}
                >
                  <span>{currentMode.name}</span>
                  <svg className={`chevron ${showModeMenu ? 'open' : ''}`} viewBox="0 0 10 6" fill="none">
                    <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                
                {showModeMenu && (
                  <div className="mode-selector-menu">
                    {MODES.map((m) => {
                      const isAvailable = m.id === 'agent' ? modelAvailability.agentAvailable : modelAvailability.inlineAvailable;
                      return (
                        <div
                          key={m.id}
                          className={`mode-option ${m.id === mode ? 'active' : ''} ${!isAvailable ? 'disabled' : ''}`}
                          onClick={() => {
                            if (isAvailable) {
                              switchMode(m.id);
                              setShowModeMenu(false);
                              window.faria.commandBar.setDropdownVisible(false);
                            }
                          }}
                          style={{ opacity: isAvailable ? 1 : 0.5, cursor: isAvailable ? 'pointer' : 'not-allowed' }}
                        >
                          <span className="mode-name">{m.name}</span>
                          <span className="mode-shortcut">{m.shortcut}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {isProcessing ? (
            <button
              className="stop-button"
              onClick={handleStop}
              title="Stop"
            >
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
