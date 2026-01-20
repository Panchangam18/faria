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
const MAX_LINES = 5;
const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * MAX_LINES; // 115px for 5 lines
const BASE_HEIGHT = 46; // Footer + padding (8px top input + 2px bottom input + 4px top footer + 8px bottom footer + ~24px footer content)
const MAX_RESPONSE_HEIGHT = 200; // Max height before scrolling kicks in

// Preset themes colors (must match SettingsPanel)
const PRESET_THEMES: Record<string, { background: string; text: string; accent: string }> = {
  default: { background: '#272932', text: '#EAE0D5', accent: '#C6AC8F' },
  midnight: { background: '#0D1117', text: '#C9D1D9', accent: '#58A6FF' },
  forest: { background: '#1A2F1A', text: '#E8F5E8', accent: '#7CB342' },
  aurora: { background: '#1a1a2e', text: '#eaeaea', accent: '#e94560' },
  obsidian: { background: '#1e1e1e', text: '#d4d4d4', accent: '#daa520' },
  ocean: { background: '#0f2027', text: '#a8dadc', accent: '#00b4d8' },
};

// Apply theme CSS variables to document
function applyTheme(theme: string, customColors?: { background: string; text: string; accent: string }, font?: string) {
  const colors = customColors || PRESET_THEMES[theme] || PRESET_THEMES.default;

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
  doc.style.setProperty('--color-primary', colors.background);
  doc.style.setProperty('--color-secondary', colors.text);
  doc.style.setProperty('--color-accent', colors.accent);

  // Derive additional colors
  doc.style.setProperty('--color-primary-light', adjustColor(colors.background, 1.2));
  doc.style.setProperty('--color-primary-dark', adjustColor(colors.background, 0.7));
  doc.style.setProperty('--color-secondary-muted', colors.text + 'B3');
  doc.style.setProperty('--color-accent-hover', adjustColor(colors.accent, 1.15));
  doc.style.setProperty('--color-accent-active', adjustColor(colors.accent, 0.85));

  // UI colors
  doc.style.setProperty('--color-background', colors.background);
  doc.style.setProperty('--color-surface', adjustColor(colors.background, 1.2));
  doc.style.setProperty('--color-text', colors.text);
  doc.style.setProperty('--color-text-muted', colors.text + 'B3');
  doc.style.setProperty('--color-border', colors.text + '26');
  doc.style.setProperty('--color-hover', colors.text + '14');

  // Font
  if (font) {
    doc.style.setProperty('--font-family', font);
  }

  // Set data-theme attribute
  doc.setAttribute('data-theme', theme === 'custom' ? 'custom' : theme);
}

function CommandBar() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [streamingResponse, setStreamingResponse] = useState('');
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedTextLength, setSelectedTextLength] = useState<number>(0); // Character count of selected text
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingAuth, setPendingAuth] = useState<{ toolkit: string; redirectUrl: string } | null>(null);
  const [pendingToolApproval, setPendingToolApproval] = useState<{ toolName: string; toolDescription: string; args: Record<string, unknown>; isComposio: boolean; displayName?: string; details?: Record<string, string> } | null>(null);
  const [toolApprovalExpanded, setToolApprovalExpanded] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);
  const toolApprovalRef = useRef<HTMLDivElement>(null);

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
    if ((response || streamingResponse) && responseRef.current) {
      // Temporarily remove max-height to measure true content height
      const el = responseRef.current;
      const originalMaxHeight = el.style.maxHeight;
      el.style.maxHeight = 'none';
      const actualHeight = el.scrollHeight;
      el.style.maxHeight = originalMaxHeight;
      responseHeight = Math.min(actualHeight, MAX_RESPONSE_HEIGHT) + 16; // +16 for margin
    }

    // Calculate tool approval height
    let toolApprovalHeight = 0;
    if (pendingToolApproval && toolApprovalRef.current) {
      toolApprovalHeight = toolApprovalRef.current.scrollHeight;
    }

    // Calculate and set window height
    const totalHeight = BASE_HEIGHT + contentHeight + responseHeight + toolApprovalHeight;
    window.faria.commandBar.resize(totalHeight);
  }, [query, response, streamingResponse, pendingToolApproval, toolApprovalExpanded]);

  // Load theme on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const theme = await window.faria.settings.get('theme') || 'default';
        const font = await window.faria.settings.get('selectedFont') || "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

        let customColors: { background: string; text: string; accent: string } | undefined;

        if (theme === 'custom') {
          const customPalettes = await window.faria.settings.get('customPalettes');
          const activeCustomPalette = await window.faria.settings.get('activeCustomPalette');

          if (customPalettes && activeCustomPalette) {
            try {
              const palettes = JSON.parse(customPalettes);
              const activePalette = palettes.find((p: any) => p.name === activeCustomPalette);
              if (activePalette) {
                customColors = {
                  background: activePalette.background,
                  text: activePalette.text,
                  accent: activePalette.accent
                };
              }
            } catch (e) {
              console.error('[CommandBar] Error parsing custom palettes:', e);
            }
          }
        }

        applyTheme(theme, customColors, font);
      } catch (e) {
        console.error('[CommandBar] Error loading settings:', e);
      }
    };

    loadSettings();

    // Listen for theme changes
    window.faria.settings.onThemeChange((themeData) => {
      applyTheme(themeData.theme, themeData.customColors, themeData.font);
    });
  }, []);

  useEffect(() => {
    // Reset state when command bar is about to hide (but keep processing state for persistence)
    window.faria.commandBar.onWillHide(() => {
      setSelectedTextLength(0);
      setErrorMessage(null);
      // Don't clear isProcessing, status, or pendingAuth - keep them when command bar reopens
    });

    // Focus input when command bar becomes visible
    window.faria.commandBar.onFocus(() => {
      inputRef.current?.focus();
    });

    // Listen for ready state (detection complete) - just update selected text length
    window.faria.commandBar.onReady((data) => {
      setSelectedTextLength(data.selectedTextLength);
    });

    // Listen for status updates from agent
    window.faria.agent.onStatus((newStatus: string) => {
      setStatus(newStatus);
    });

    // Listen for streaming chunks from agent
    window.faria.agent.onChunk((chunk: string) => {
      setStreamingResponse(prev => prev + chunk);
    });

    // Listen for final response from agent
    window.faria.agent.onResponse((newResponse: string) => {
      setResponse(newResponse);
      setStreamingResponse(''); // Clear streaming state
      setIsProcessing(false);
      setStatus('');
      setPendingAuth(null);
      setPendingToolApproval(null);
    });

    // Listen for auth-required from agent (Composio OAuth flow)
    window.faria.agent.onAuthRequired((data) => {
      console.log('[CommandBar] Auth required:', data);
      setPendingAuth(data);
      setStatus(`Waiting for ${data.toolkit} authentication...`);
    });

    // Listen for tool approval required from agent
    window.faria.agent.onToolApprovalRequired((data) => {
      console.log('[CommandBar] Tool approval required:', data);
      setPendingToolApproval(data);
      setStatus('Waiting for approval...');
    });

    // Listen for error messages
    window.faria.commandBar.onError((error) => {
      setErrorMessage(error);
      setResponse(`Error: ${error}`);
      setIsProcessing(false);
      setStatus('');
      setPendingAuth(null);
      // Clear error after 3 seconds
      setTimeout(() => {
        setErrorMessage(null);
        setResponse('');
      }, 3000);
    });

    // Listen for reset event (clears all state completely)
    window.faria.commandBar.onReset(() => {
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
  }, []);

  // Reset expanded state when tool approval changes
  useEffect(() => {
    setToolApprovalExpanded(false);
  }, [pendingToolApproval]);

  // Global keyboard listener for tool approval shortcuts
  useEffect(() => {
    if (!pendingToolApproval) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        // Trigger allow
        console.log('[CommandBar] Enter pressed, approving tool');
        setPendingToolApproval(null);
        setStatus('Executing...');
        window.faria.agent.toolApprovalResponse(true);
      }
      if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        // Trigger deny/cancel
        console.log('[CommandBar] Ctrl+C pressed, denying tool and cancelling');
        setPendingToolApproval(null);
        setToolApprovalExpanded(false);
        window.faria.agent.cancel();
        setIsProcessing(false);
        setStatus('');
        // Refocus the input after state updates
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [pendingToolApproval]);

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
    await window.faria.agent.cancel();
    setIsProcessing(false);
    setStatus('');
    setPendingAuth(null);
    setPendingToolApproval(null);
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
    console.log('[CommandBar] Tool denied, cancelling agent:', pendingToolApproval.toolName);
    setPendingToolApproval(null);
    setToolApprovalExpanded(false);
    // Cancel the agent entirely (deny acts as stop)
    await window.faria.agent.cancel();
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

  return (
    <div className="command-bar">
      <div className="command-bar-input-area">
        <textarea
          ref={inputRef}
          className="command-bar-input"
          placeholder="What do you seek?"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={isProcessing}
          rows={1}
        />
      </div>

      {(response || streamingResponse || errorMessage) && (
        <div className="command-bar-response" ref={responseRef} style={errorMessage ? { color: 'var(--color-error, #ff4444)' } : undefined}>
          {errorMessage || response || streamingResponse}
        </div>
      )}

      <div className="command-bar-footer">
        <div className="footer-left">
          {pendingToolApproval ? (
            <div className="command-bar-tool-approval" ref={toolApprovalRef}>
              <div className="tool-approval-header">
                {pendingToolApproval.details && Object.keys(pendingToolApproval.details).length > 0 ? (
                  <button
                    className="tool-approval-toggle"
                    onClick={() => setToolApprovalExpanded(!toolApprovalExpanded)}
                  >
                    <span className="tool-approval-name">
                      {pendingToolApproval.isComposio
                        ? pendingToolApproval.displayName || `Use ${formatToolkitName(pendingToolApproval.toolName.split('_')[0])}`
                        : 'Allow computer control?'}
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
                    {pendingToolApproval.isComposio
                      ? pendingToolApproval.displayName || `Use ${formatToolkitName(pendingToolApproval.toolName.split('_')[0])}`
                      : 'Allow computer control?'}
                  </span>
                )}
                <div className="tool-approval-buttons">
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
                    <div key={key} className="tool-approval-detail">
                      <span className="detail-key">{key}:</span> {value}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : pendingAuth ? (
            <div className="command-bar-auth-inline">
              <span className="auth-status-text">
                Faria wants to use {formatToolkitName(pendingAuth.toolkit)}...
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
        <div className="footer-right">
          {/* Selection indicator - shows character count when text is selected */}
          {selectedTextLength > 0 && (
            <span className="selection-indicator" title="Selected text">{selectedTextLength} chars</span>
          )}

          {/* Hide stop/send buttons when tool approval is showing (it has its own stop button) */}
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
    </div>
  );
}

export default CommandBar;
