import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { IoMdSend } from 'react-icons/io';
import { IoStopCircleSharp } from 'react-icons/io5';

// Format toolkit slug into proper display name
function formatToolkitName(slug: string): string {
  const directMappings: Record<string, string> = {
    'perplexityai': 'Perplexity AI',
    'retellai': 'Retell AI',
    'openai': 'OpenAI',
    'googlecalendar': 'Google Calendar',
    'googledrive': 'Google Drive',
    'googlesheets': 'Google Sheets',
    'googledocs': 'Google Docs',
    'googlemeet': 'Google Meet',
    'googlemail': 'Google Mail',
    'github': 'GitHub',
    'gitlab': 'GitLab',
    'linkedin': 'LinkedIn',
    'youtube': 'YouTube',
    'chatgpt': 'ChatGPT',
    'hubspot': 'HubSpot',
    'clickup': 'ClickUp',
    'sendgrid': 'SendGrid',
    'whatsapp': 'WhatsApp',
    'tiktok': 'TikTok',
    'soundcloud': 'SoundCloud',
    'woocommerce': 'WooCommerce',
  };

  const lowerSlug = slug.toLowerCase();
  if (directMappings[lowerSlug]) {
    return directMappings[lowerSlug];
  }

  // Split on common patterns and capitalize
  return slug
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-z])(ai)$/i, '$1 $2')
    .replace(/(calendar|drive|sheets|docs|mail|meet|chat|cloud|hub)$/gi, ' $1')
    .split(' ')
    .map(word => {
      const lower = word.toLowerCase();
      if (['ai', 'api', 'crm', 'io'].includes(lower)) return lower.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .trim();
}

// Line height is 14px (font-size-sm) * 1.5 = 21px
const LINE_HEIGHT = 21;
const MAX_LINES = 3;
const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * MAX_LINES; // 63px for 3 lines
const CONTROLS_GAP = 4; // Breathing room between text and inline controls
const BASE_HEIGHT = 18; // Input area padding (8 top + 8 bottom) + border (2)
const MAX_RESPONSE_HEIGHT = 200; // Max height before scrolling kicks in

// Placeholder texts
const PLACEHOLDER_TEXTS = [
  "What do you seek?",
  "What weighs upon your mind?",
  "The present is but a bridge...",
  "In what direction shall we proceed?",
  "Time reveals all things...",
  "What truth shall we uncover?",
  "What hidden thing seeks light?",
  "Life is a tempest, one must learn to sail...",
  "What door shall we open?",
  "In what cavern of thought shall we dwell?",
  "What sleeping thing shall we awaken?",
  "To wait and to hope...",
  "What treasure lies buried in your mind?",
  "What revenge upon ignorance shall we take?",
  "The slow unraveling of all things...",
  "One must have lived to know...",
  "What shadows dance at the edge of understanding?",
  "What song does solitude sing?",
  "What melody does the wind play?",
  "What shadow does the sun cast?",
];

// Default theme colors (fallback only)
const DEFAULT_COLORS = { background: '#272932', text: '#EAE0D5', accent: '#C6AC8F' };

// Apply theme CSS variables to document
function applyTheme(theme: string, colors?: { background: string; text: string; accent: string }, font?: string) {
  const c = colors || DEFAULT_COLORS;

  // Helper to lighten/darken colors
  const adjustColor = (hex: string, factor: number): string => {
    const h = hex.replace('#', '');
    const r = Math.min(255, Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * factor)));
    const g = Math.min(255, Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * factor)));
    const b = Math.min(255, Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * factor)));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  const doc = document.documentElement;

  // Set base colors
  doc.style.setProperty('--color-primary', c.background);
  doc.style.setProperty('--color-secondary', c.text);
  doc.style.setProperty('--color-accent', c.accent);

  // Derive additional colors
  doc.style.setProperty('--color-primary-light', adjustColor(c.background, 1.2));
  doc.style.setProperty('--color-primary-dark', adjustColor(c.background, 0.7));
  doc.style.setProperty('--color-secondary-muted', c.text + 'B3');
  doc.style.setProperty('--color-accent-hover', adjustColor(c.accent, 1.15));
  doc.style.setProperty('--color-accent-active', adjustColor(c.accent, 0.85));

  // UI colors
  doc.style.setProperty('--color-background', c.background);
  doc.style.setProperty('--color-surface', adjustColor(c.background, 1.2));
  doc.style.setProperty('--color-text', c.text);
  doc.style.setProperty('--color-text-muted', c.text + 'B3');
  doc.style.setProperty('--color-border', c.text + '26');
  doc.style.setProperty('--color-hover', c.text + '14');

  // Font
  if (font) {
    doc.style.setProperty('--font-family', font);
  }

  // Set data-theme attribute
  doc.setAttribute('data-theme', theme === 'custom' ? 'custom' : theme);
}

function CommandBar() {
  const [query, setQuery] = useState('');
  const [placeholder, setPlaceholder] = useState('...');
  const [response, setResponse] = useState('');
  const [streamingResponse, setStreamingResponse] = useState('');
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedTextLength, setSelectedTextLength] = useState<number>(0); // Character count of selected text
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAuth, setPendingAuth] = useState<{ toolkit: string; redirectUrl: string } | null>(null);
  const [pendingToolApproval, setPendingToolApproval] = useState<{ toolName: string; toolDescription: string; args: Record<string, unknown>; isComposio: boolean; displayName?: string; details?: Record<string, string> } | null>(null);
  const [toolApprovalExpanded, setToolApprovalExpanded] = useState(false);
  const [opacity, setOpacity] = useState(0.7);
  const [backgroundColor, setBackgroundColor] = useState('#272932'); // Track background color for opacity
  const [isVisible, setIsVisible] = useState(false); // Controls content visibility to prevent flash of old content
  const [isScrollable, setIsScrollable] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollWrapperRef = useRef<HTMLDivElement>(null);
  const inlineControlsRef = useRef<HTMLDivElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const toolApprovalRef = useRef<HTMLDivElement>(null);

  // Check if the last visual line of text collides with the inline controls.
  // Uses a mirror div with an appended marker span to find the x-position
  // where text ends on the last visual line, so soft-wrapped earlier lines
  // can't trigger a false positive.
  const wouldControlsCollide = useCallback((textarea: HTMLTextAreaElement, controlsWidth: number): boolean => {
    if (!textarea.value) return false;
    const mirror = document.createElement('div');
    const style = getComputedStyle(textarea);
    mirror.style.cssText = `
      position: absolute; visibility: hidden; white-space: pre-wrap;
      word-break: break-word; overflow-wrap: break-word;
      font: ${style.font}; letter-spacing: ${style.letterSpacing};
      width: ${textarea.clientWidth}px; padding: 0; border: 0;
    `;
    // Append text + zero-width marker at the end
    mirror.appendChild(document.createTextNode(textarea.value));
    const marker = document.createElement('span');
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    // marker.offsetLeft = x-position where the last visual line's text ends
    const lastLineEndX = marker.offsetLeft;
    document.body.removeChild(mirror);
    return lastLineEndX >= textarea.clientWidth - controlsWidth;
  }, []);

  // Resize window based on textarea content - debounced to avoid blocking rapid toggles
  const lastResizeRef = useRef<number>(0);
  useLayoutEffect(() => {
    const textarea = inputRef.current;
    const scrollWrapper = scrollWrapperRef.current;
    const controlsEl = inlineControlsRef.current;
    if (!textarea || !scrollWrapper) return;

    // Measure controls dimensions
    const controlsWidth = controlsEl ? controlsEl.offsetWidth + CONTROLS_GAP : 0;
    const controlsHeight = controlsEl ? controlsEl.offsetHeight : 0;

    // Save scroll position before measurement — collapsing height to 0 resets scrollTop
    const savedScrollTop = scrollWrapper.scrollTop;

    // First pass: measure raw content height without any extra padding.
    // Temporarily clear min-height so we get the true content height
    // (min-height: 21px in CSS inflates scrollHeight for single-line content).
    textarea.style.paddingBottom = '0px';
    textarea.style.height = '0px';
    textarea.style.minHeight = '0px';

    const rawScrollHeight = textarea.scrollHeight;

    textarea.style.minHeight = '';

    // Read the browser's actual computed line-height (px value) so padding
    // matches exactly where the next text line would appear.
    const computedLineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || LINE_HEIGHT;

    const scrollable = rawScrollHeight > MAX_TEXTAREA_HEIGHT;
    setIsScrollable(scrollable);

    if (!scrollable && textarea.value) {
      if (rawScrollHeight >= MAX_TEXTAREA_HEIGHT) {
        // At max lines: always reserve space for controls row so the transition
        // to scrollable mode (where controls become a static row) is seamless
        textarea.style.paddingBottom = `${computedLineHeight}px`;
      } else if (wouldControlsCollide(textarea, controlsWidth)) {
        // Below max lines: only add padding when text actually collides with controls.
        // Use computedLineHeight so the controls drop by exactly one text line —
        // matching where the next line of text will appear when it wraps.
        textarea.style.paddingBottom = `${computedLineHeight}px`;
      }
    }

    // Let textarea expand to full content height (wrapper handles capping/scrolling)
    const scrollHeight = textarea.scrollHeight;
    textarea.style.height = `${scrollHeight}px`;

    // The visible height is capped by the wrapper's max-height.
    // When not scrollable, use full scrollHeight (includes any collision padding)
    // so the window is tall enough to show the send button row.
    const contentHeight = scrollable
      ? MAX_TEXTAREA_HEIGHT
      : Math.max(LINE_HEIGHT, scrollHeight);

    // Toggle scrollable class on the wrapper and cap its height
    if (scrollable) {
      scrollWrapper.classList.add('scrollable');
      scrollWrapper.style.maxHeight = `${MAX_TEXTAREA_HEIGHT}px`;
    } else {
      scrollWrapper.classList.remove('scrollable');
      scrollWrapper.style.maxHeight = '';
    }

    // Restore scroll position after measurement — the height:0 collapse reset it
    scrollWrapper.scrollTop = savedScrollTop;

    // Calculate response height (actual content height, capped at max)
    let responseHeight = 0;
    if ((response || streamingResponse) && responseRef.current) {
      // Temporarily remove max-height to measure true content height
      const el = responseRef.current;
      const originalMaxHeight = el.style.maxHeight;
      el.style.maxHeight = 'none';
      const actualHeight = el.scrollHeight;
      el.style.maxHeight = originalMaxHeight;
      responseHeight = Math.min(actualHeight, MAX_RESPONSE_HEIGHT) + 16; // +16 for margin
    }

    // Calculate footer height (only present when tool approval, auth, or status showing)
    let footerHeight = 0;
    if (pendingToolApproval && toolApprovalRef.current) {
      footerHeight = toolApprovalRef.current.scrollHeight + 16; // +16 for footer padding
    } else if (pendingAuth || status) {
      footerHeight = 36; // Approximate height for auth/status rows with padding
    }

    // When scrollable, controls become a static row below the textarea
    const controlsRowHeight = scrollable ? controlsHeight : 0;

    // Calculate and set window height - debounce to avoid IPC spam during rapid toggle
    const totalHeight = BASE_HEIGHT + contentHeight + controlsRowHeight + responseHeight + footerHeight;
    if (totalHeight !== lastResizeRef.current) {
      lastResizeRef.current = totalHeight;
      window.faria.commandBar.resize(totalHeight);
    }
  }, [query, response, streamingResponse, pendingToolApproval, toolApprovalExpanded, pendingAuth, status, wouldControlsCollide, selectedTextLength]);

  // Load theme on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Get theme data from main process (single source of truth for colors)
        const themeData = await window.faria.settings.getThemeData();
        applyTheme(themeData.theme, themeData.colors, themeData.font);
        setBackgroundColor(themeData.colors.background);

        // Load opacity setting
        const savedOpacity = await window.faria.settings.get('commandBarOpacity');
        if (savedOpacity) {
          setOpacity(parseFloat(savedOpacity));
        }
      } catch (e) {
        console.error('[CommandBar] Error loading settings:', e);
      }
    };

    loadSettings();

    // Listen for theme changes - colors are always provided by main process
    const cleanupTheme = window.faria.settings.onThemeChange((themeData) => {
      applyTheme(themeData.theme, themeData.colors, themeData.font);
      setBackgroundColor(themeData.colors.background);
    });

    // Listen for opacity changes
    const cleanupOpacity = window.faria.settings.onOpacityChange((newOpacity) => {
      setOpacity(newOpacity);
    });

    return () => {
      cleanupTheme();
      cleanupOpacity();
    };
  }, []);

  useEffect(() => {
    // Reset state when command bar is about to hide (but keep processing state for persistence)
    const cleanupWillHide = window.faria.commandBar.onWillHide(() => {
      // Hide content immediately to prevent flash of old content on reopen
      setIsVisible(false);
      setSelectedTextLength(0);
      setErrorMessage(null);
      // Clear streaming response (incomplete placeholder content) but keep final response
      // Response persists so user can see agent's answer when they reopen
      setStreamingResponse('');
      setPlaceholder('...');
      // Don't clear isProcessing, status, response, or pendingAuth - keep them when command bar reopens
    });

    // Focus input when command bar becomes visible and refresh selection
    const cleanupFocus = window.faria.commandBar.onFocus(() => {
      setPlaceholder(PLACEHOLDER_TEXTS[Math.floor(Math.random() * PLACEHOLDER_TEXTS.length)]);
      // Show content now that state is fresh
      setIsVisible(true);
      inputRef.current?.focus();

      // Refresh selected text in case user selected new text after opening command bar
      window.faria.commandBar.refreshSelection().then((data) => {
        setSelectedTextLength(data.selectedTextLength);
      }).catch((e) => {
        console.error('[CommandBar] Failed to refresh selection:', e);
      });
    });

    // Listen for ready state (detection complete) - just update selected text length
    const cleanupReady = window.faria.commandBar.onReady((data) => {
      setSelectedTextLength(data.selectedTextLength);
    });

    // Listen for status updates from agent
    const cleanupStatus = window.faria.agent.onStatus((newStatus: string) => {
      setStatus(newStatus);
    });

    // Listen for streaming chunks from agent
    const cleanupChunk = window.faria.agent.onChunk((chunk: string) => {
      setStreamingResponse(prev => prev + chunk);
    });

    // Listen for final response from agent
    const cleanupResponse = window.faria.agent.onResponse((newResponse: string) => {
      setResponse(newResponse);
      setStreamingResponse(''); // Clear streaming state
      setIsProcessing(false);
      setStatus('');
      setPendingAuth(null);
      setPendingToolApproval(null);
      // Refocus input after response
      setTimeout(() => inputRef.current?.focus(), 0);
    });

    // Listen for auth-required from agent (Composio OAuth flow)
    const cleanupAuth = window.faria.agent.onAuthRequired((data) => {
      console.log('[CommandBar] Auth required:', data);
      setPendingAuth(data);
      setStatus(`Waiting for ${data.toolkit} authentication...`);
    });

    // Listen for tool approval required from agent
    const cleanupToolApproval = window.faria.agent.onToolApprovalRequired((data) => {
      console.log('[CommandBar] Tool approval required:', data);
      setPendingToolApproval(data);
      setStatus('Waiting for approval...');
    });

    // Listen for error messages
    const cleanupError = window.faria.commandBar.onError((error) => {
      setErrorMessage(error);
      setResponse(`Error: ${error}`);
      setIsProcessing(false);
      setStatus('');
      setPendingAuth(null);
      // Refocus input after error
      setTimeout(() => inputRef.current?.focus(), 0);
      // Clear error after 3 seconds
      setTimeout(() => {
        setErrorMessage(null);
        setResponse('');
      }, 3000);
    });

    // Listen for reset event (clears all state completely)
    const cleanupReset = window.faria.commandBar.onReset(() => {
      setQuery('');
      setResponse('');
      setStreamingResponse('');
      setStatus('');
      setIsProcessing(false);
      setSelectedTextLength(0);
      setErrorMessage(null);
      setPendingAuth(null);
      setPendingToolApproval(null);
      setToolApprovalExpanded(false);
    });

    // Cleanup all listeners on unmount
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

  // Reset expanded state when tool approval changes
  useEffect(() => {
    setToolApprovalExpanded(false);
  }, [pendingToolApproval]);

  // Global keyboard listener for Ctrl+C to cancel and tool approval shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ctrl+C to cancel agent when processing (not Cmd+C which is copy on macOS)
      if (e.key === 'c' && e.ctrlKey && !e.metaKey && isProcessing) {
        e.preventDefault();
        setPendingToolApproval(null);
        setToolApprovalExpanded(false);
        window.faria.agent.cancel('ctrl-c-pressed');
        setIsProcessing(false);
        setStatus('');
        // Refocus the input after state updates
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }

      // Tool approval shortcuts
      if (pendingToolApproval) {
        if (e.key === 'Enter') {
          e.preventDefault();
          console.log('[CommandBar] Enter pressed, approving tool');
          setPendingToolApproval(null);
          setStatus('Executing...');
          window.faria.agent.toolApprovalResponse(true);
        }
        // Shift+Tab to toggle expanded view (only when there are details to show)
        if (e.key === 'Tab' && e.shiftKey && pendingToolApproval.details && Object.keys(pendingToolApproval.details).length > 0) {
          e.preventDefault();
          setToolApprovalExpanded(prev => !prev);
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [pendingToolApproval, isProcessing]);

  const handleSubmit = useCallback(async () => {
    if (!query.trim() || isProcessing) return;

    setIsProcessing(true);
    setResponse('');
    setStreamingResponse('');

    try {
      setStatus('Extracting state...');
      const result = await window.faria.agent.submit(query);
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
  }, [query, isProcessing]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuery(e.target.value);
  };

  const handleStop = useCallback(async () => {
    if (!isProcessing) return;
    await window.faria.agent.cancel('stop-button-clicked');
    setIsProcessing(false);
    setStatus('');
    setPendingAuth(null);
    setPendingToolApproval(null);
    // Refocus input after stop
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [isProcessing]);

  const handleOpenAuthUrl = useCallback(() => {
    if (!pendingAuth) return;
    // Open the auth URL in the default browser
    window.faria.shell.openExternal(pendingAuth.redirectUrl);
  }, [pendingAuth]);

  const handleAuthComplete = useCallback(() => {
    if (!pendingAuth) return;
    console.log('[CommandBar] Auth completed, notifying agent');
    setPendingAuth(null);
    setStatus('Resuming...');
    window.faria.agent.authCompleted();
  }, [pendingAuth]);

  const handleToolApprove = useCallback(() => {
    if (!pendingToolApproval) return;
    console.log('[CommandBar] Tool approved:', pendingToolApproval.toolName);
    setPendingToolApproval(null);
    setStatus('Executing...');
    window.faria.agent.toolApprovalResponse(true);
  }, [pendingToolApproval]);

  const handleToolDeny = useCallback(async () => {
    if (!pendingToolApproval) return;
    setPendingToolApproval(null);
    setToolApprovalExpanded(false);
    // Cancel the agent entirely (deny acts as stop)
    await window.faria.agent.cancel('tool-deny-button-clicked');
    setIsProcessing(false);
    setStatus('');
  }, [pendingToolApproval]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Tool approval shortcuts handled by global listener
    if (pendingToolApproval) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      window.faria.commandBar.hide();
    }
  }, [handleSubmit, pendingToolApproval]);

  // Refresh selection when clicking in the command bar (in case user selected new text)
  const handleCommandBarClick = useCallback(() => {
    window.faria.commandBar.refreshSelection().then((data) => {
      setSelectedTextLength(data.selectedTextLength);
    }).catch((e) => {
      console.error('[CommandBar] Failed to refresh selection on click:', e);
    });
  }, []);

  // Get background color with opacity from current theme
  const getBackgroundWithOpacity = () => {
    const hex = backgroundColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  return (
    <div className="command-bar" style={{ background: getBackgroundWithOpacity(), visibility: isVisible ? 'visible' : 'hidden' }} onClick={handleCommandBarClick}>
      <div className={`command-bar-input-area${isScrollable ? ' scrollable' : ''}`}>
        <div className="command-bar-input-scroll" ref={scrollWrapperRef}>
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
        <div className="input-inline-controls" ref={inlineControlsRef}>
          {selectedTextLength > 0 && !pendingToolApproval && (
            <span className="selection-indicator" title="Selected text">{selectedTextLength} chars</span>
          )}
          {!pendingToolApproval && (
            isProcessing ? (
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
            )
          )}
        </div>
      </div>

      {(response || streamingResponse || errorMessage) && (
        <div className="command-bar-response" ref={responseRef} style={errorMessage ? { color: 'var(--color-error, #ff4444)' } : undefined}>
          {errorMessage || response || streamingResponse}
        </div>
      )}

      {(pendingToolApproval || pendingAuth || status) && (
        <div className="command-bar-footer">
          {pendingToolApproval ? (
            <div className="command-bar-tool-approval" ref={toolApprovalRef}>
              <div className="tool-approval-header">
                {pendingToolApproval.details && Object.keys(pendingToolApproval.details).length > 0 ? (
                  <button
                    className="tool-approval-toggle"
                    onClick={() => setToolApprovalExpanded(!toolApprovalExpanded)}
                  >
                    <span className="tool-approval-shortcut">&#8679;&#8677;</span>
                    <span className="tool-approval-name">
                      {pendingToolApproval.displayName || (pendingToolApproval.isComposio
                        ? `Use ${formatToolkitName(pendingToolApproval.toolName.split('_')[0])}`
                        : 'Allow computer control?')}
                    </span>
                    <svg
                      className={`chevron ${toolApprovalExpanded ? 'open' : ''}`}
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M2 3.5L5 6.5L8 3.5" />
                    </svg>
                  </button>
                ) : (
                  <span className="tool-approval-name-static">
                    {pendingToolApproval.displayName || (pendingToolApproval.isComposio
                      ? `Use ${formatToolkitName(pendingToolApproval.toolName.split('_')[0])}`
                      : 'Allow computer control?')}
                  </span>
                )}
                <div className="tool-approval-buttons">
                  {selectedTextLength > 0 && (
                    <span className="selection-indicator" title="Selected text">{selectedTextLength} chars</span>
                  )}
                  <button className="auth-inline-button auth-inline-connect" onClick={handleToolApprove}>
                    <span className="button-shortcut">↵</span> Allow
                  </button>
                  <button className="auth-inline-button auth-inline-done" onClick={handleToolDeny}>
                    <span className="button-shortcut">⌃C</span> Deny
                  </button>
                </div>
              </div>
              {toolApprovalExpanded && pendingToolApproval.details && Object.keys(pendingToolApproval.details).length > 0 && (
                <div className="tool-approval-details">
                  {Object.entries(pendingToolApproval.details).map(([key, value]) => (
                    <div key={key || 'content'} className="tool-approval-detail">
                      {key ? <><span className="detail-key">{key}:</span> {value}</> : value}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : pendingAuth ? (
            <div className="command-bar-auth-inline">
              <span className="auth-status-text" style={{ fontStyle: 'normal' }}>
                Faria wants to use {formatToolkitName(pendingAuth.toolkit)}
              </span>
              <button className="auth-inline-button auth-inline-connect" onClick={handleOpenAuthUrl}>
                Connect
              </button>
              <button className="auth-inline-button auth-inline-done" onClick={handleAuthComplete}>
                Done
              </button>
            </div>
          ) : status ? (
            <div className="command-bar-status">
              <div className="status-spinner" />
              <span>{status}</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default CommandBar;
