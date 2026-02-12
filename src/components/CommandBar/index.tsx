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

// Get the pixel rect of the caret at the current selectionStart using a mirror div.
function getCaretRect(textarea: HTMLTextAreaElement): { top: number; left: number } | null {
  const mirror = document.createElement('div');
  const style = getComputedStyle(textarea);
  mirror.style.cssText = `
    position: absolute; visibility: hidden; white-space: pre-wrap;
    word-break: break-word; overflow-wrap: break-word;
    font: ${style.font}; letter-spacing: ${style.letterSpacing};
    line-height: ${style.lineHeight}; padding: ${style.padding};
    width: ${textarea.clientWidth}px; border: 0;
  `;
  const text = textarea.value.substring(0, textarea.selectionStart);
  mirror.appendChild(document.createTextNode(text));
  const marker = document.createElement('span');
  marker.textContent = '\u200b'; // zero-width space so it has height
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop;
  const left = marker.offsetLeft;
  document.body.removeChild(mirror);
  return { top, left };
}

// Line height is 14px (font-size-sm) * 1.5 = 21px
const LINE_HEIGHT = 21;
const MAX_LINES = 3;
const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * MAX_LINES; // 63px for 3 lines
const CONTROLS_GAP = 4; // Breathing room between text and inline controls
const BASE_HEIGHT = 18; // Input area padding (8 top + 8 bottom) + border (2)
const RESPONSE_LINE_HEIGHT = 17.6; // 11px (font-size-xs) * 1.6 line-height
const MAX_RESPONSE_LINES = 5;
const MAX_RESPONSE_HEIGHT = RESPONSE_LINE_HEIGHT * MAX_RESPONSE_LINES; // 88px

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
  const placeholder = 'What do you seek?';
  const [response, setResponse] = useState('');
  const [streamingResponse, setStreamingResponse] = useState('');
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // History navigation state
  const [historyIndex, setHistoryIndex] = useState(-1); // -1 = not navigating history
  const historyRef = useRef<Array<{ query: string; response: string }>>([]);
  const draftQueryRef = useRef(''); // Saves the user's in-progress query before navigating
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
  const agentAreaRef = useRef<HTMLDivElement>(null);

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

    // Measure agent area height (response + footer + divider — all above the input)
    // Temporarily remove overflow and max-height on the response div so its full
    // content height contributes to the agent area's scrollHeight. Then cap the
    // result so the response never exceeds MAX_RESPONSE_HEIGHT (scrolls instead).
    let agentAreaHeight = 0;
    if (agentAreaRef.current) {
      const respEl = responseRef.current;
      if (respEl) {
        respEl.style.overflow = 'visible';
        respEl.style.maxHeight = 'none';
      }
      const uncappedHeight = agentAreaRef.current.scrollHeight;
      const responseContentHeight = respEl ? respEl.scrollHeight : 0;
      if (respEl) {
        respEl.style.overflow = '';
        respEl.style.maxHeight = '';
      }
      // Cap: if response content exceeds the max, shrink by the overflow amount
      if (respEl && responseContentHeight > MAX_RESPONSE_HEIGHT) {
        agentAreaHeight = uncappedHeight - (responseContentHeight - MAX_RESPONSE_HEIGHT);
      } else {
        agentAreaHeight = uncappedHeight;
      }
    }

    // When scrollable, controls become a static row below the textarea
    const controlsRowHeight = scrollable ? controlsHeight : 0;

    // Calculate total window height and send resize
    const inputAreaHeight = BASE_HEIGHT + contentHeight + controlsRowHeight;
    const sendResize = (aaHeight: number) => {
      const total = inputAreaHeight + aaHeight;
      if (total !== lastResizeRef.current) {
        lastResizeRef.current = total;
        window.faria.commandBar.resize(total, aaHeight);
      }
    };

    sendResize(agentAreaHeight);

    // Schedule a follow-up measurement after browser layout settles.
    // When content changes abruptly (e.g. history navigation populates
    // a full response at once), the synchronous scrollHeight may not
    // yet reflect the final layout.
    const rafId = requestAnimationFrame(() => {
      if (agentAreaRef.current) {
        const respEl = responseRef.current;
        if (respEl) {
          respEl.style.overflow = 'visible';
          respEl.style.maxHeight = 'none';
        }
        const uncapped = agentAreaRef.current.scrollHeight;
        const respHeight = respEl ? respEl.scrollHeight : 0;
        if (respEl) {
          respEl.style.overflow = '';
          respEl.style.maxHeight = '';
        }
        const settled = respEl && respHeight > MAX_RESPONSE_HEIGHT
          ? uncapped - (respHeight - MAX_RESPONSE_HEIGHT)
          : uncapped;
        if (settled !== agentAreaHeight) {
          sendResize(settled);
        }
      }
    });

    return () => cancelAnimationFrame(rafId);
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
      // Reset history navigation
      setHistoryIndex(-1);
      historyRef.current = [];
      // Don't clear isProcessing, status, response, or pendingAuth - keep them when command bar reopens
    });

    // Focus input when command bar becomes visible and refresh selection
    const cleanupFocus = window.faria.commandBar.onFocus(() => {
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
      setHistoryIndex(-1);
      historyRef.current = [];
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

  // Auto-scroll response to bottom as streaming content arrives
  useEffect(() => {
    if (responseRef.current && streamingResponse) {
      responseRef.current.scrollTop = responseRef.current.scrollHeight;
    }
  }, [streamingResponse]);

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
    // Reset history navigation when user types
    if (historyIndex !== -1) {
      setHistoryIndex(-1);
      historyRef.current = [];
    }
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Tool approval shortcuts handled by global listener
    if (pendingToolApproval) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Reset history navigation on submit
      setHistoryIndex(-1);
      historyRef.current = [];
      handleSubmit();
    }
    if (e.key === 'Escape') {
      window.faria.commandBar.hide();
    }

    // History navigation with ArrowUp/ArrowDown (only when not processing)
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isProcessing) {
      const textarea = inputRef.current;
      if (!textarea) return;

      // ArrowDown does nothing when not navigating history
      if (e.key === 'ArrowDown' && historyIndex === -1) return;

      // Check if the cursor can move within the textarea (multiline / soft-wrap).
      // For ArrowUp: if cursor is on the first visual row, there's nowhere to go up.
      // For ArrowDown: if cursor is on the last visual row, there's nowhere to go down.
      // We detect this by checking if the cursor is already at the top (ArrowUp) or
      // bottom (ArrowDown) row using a coordinate-based approach.
      const cursorPos = textarea.selectionStart;
      if (e.key === 'ArrowUp' && cursorPos > 0) {
        // Move cursor to position 0 temporarily to get top-row Y, then restore
        textarea.setSelectionRange(0, 0);
        const topRect = getCaretRect(textarea);
        textarea.setSelectionRange(cursorPos, cursorPos);
        const curRect = getCaretRect(textarea);
        // If cursor Y is below the first row, let the browser handle normal navigation
        if (curRect && topRect && curRect.top > topRect.top) return;
      }
      if (e.key === 'ArrowDown') {
        const len = textarea.value.length;
        if (cursorPos < len) {
          textarea.setSelectionRange(len, len);
          const botRect = getCaretRect(textarea);
          textarea.setSelectionRange(cursorPos, cursorPos);
          const curRect = getCaretRect(textarea);
          if (curRect && botRect && curRect.top < botRect.top) return;
        }
      }

      e.preventDefault();

      // First ArrowUp: fetch history and save draft
      if (historyIndex === -1 && e.key === 'ArrowUp') {
        draftQueryRef.current = query;
        window.faria.history.get().then((entries) => {
          if (!entries || entries.length === 0) return;
          historyRef.current = entries; // already sorted newest-first
          setHistoryIndex(0);
          setQuery(entries[0].query);
          setResponse(entries[0].response);
        });
        return;
      }

      // Navigate within loaded history
      const history = historyRef.current;
      if (history.length === 0) return;

      if (e.key === 'ArrowUp') {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setQuery(history[newIndex].query);
        setResponse(history[newIndex].response);
      } else {
        // ArrowDown
        const newIndex = historyIndex - 1;
        if (newIndex < 0) {
          // Back to draft
          setHistoryIndex(-1);
          setQuery(draftQueryRef.current);
          setResponse('');
          historyRef.current = [];
        } else {
          setHistoryIndex(newIndex);
          setQuery(history[newIndex].query);
          setResponse(history[newIndex].response);
        }
      }
    }
  }, [handleSubmit, pendingToolApproval, isProcessing, query, historyIndex]);

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

  const hasAgentContent = !!(response || streamingResponse || errorMessage || pendingToolApproval || pendingAuth || status);

  return (
    <div className="command-bar" style={{ background: getBackgroundWithOpacity(), visibility: isVisible ? 'visible' : 'hidden' }} onClick={handleCommandBarClick}>
      {/* Agent area: appears above input, grows upward */}
      {hasAgentContent && (
        <div className="command-bar-agent-area" ref={agentAreaRef}>
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
                      <button className="auth-inline-button auth-inline-connect" onClick={handleToolApprove}>
                        <span className="button-shortcut">↵</span> Allow
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

          <div className="command-bar-divider" />
        </div>
      )}

      {/* User input area: always at the bottom */}
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
          {selectedTextLength > 0 && (
            <span className="selection-indicator" title="Selected text">{selectedTextLength} chars</span>
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
