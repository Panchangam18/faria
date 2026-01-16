import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { IoMdSend } from 'react-icons/io';
import { IoStopCircleSharp } from 'react-icons/io5';

type Mode = 'agent' | 'inline' | 'detecting';

const DEFAULT_AGENT_SWITCH_SHORTCUT = 'CommandOrControl+Shift+/';

// Convert Electron accelerator to display format
const shortcutToDisplay = (accelerator: string): string => {
  return accelerator
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Control', '⌃')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace('Option', '⌥')
    .replace(/\+/g, '')
    .replace('Space', '␣')
    .toUpperCase()
    .replace('⌘', '⌘')
    .replace('⇧', '⇧')
    .replace('⌃', '⌃')
    .replace('⌥', '⌥');
};

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
  const [status, setStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [mode, setMode] = useState<Mode>('detecting');
  const [contextText, setContextText] = useState('');
  const [modelAvailability, setModelAvailability] = useState<{ agentAvailable: boolean; inlineAvailable: boolean }>({ agentAvailable: true, inlineAvailable: true });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [agentSwitchShortcut, setAgentSwitchShortcut] = useState(DEFAULT_AGENT_SWITCH_SHORTCUT);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const responseRef = useRef<HTMLDivElement>(null);

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

  // Load theme and shortcuts on mount
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

        // Load agent switch shortcut
        const savedShortcut = await window.faria.settings.get('agentSwitchShortcut');
        if (savedShortcut) {
          setAgentSwitchShortcut(savedShortcut);
        }
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
    // Focus input when command bar becomes visible
    window.faria.commandBar.onFocus(async () => {
      // Reset to detecting state on each open
      setMode('detecting');
      setContextText('');
      inputRef.current?.focus();

      // Reload shortcut in case it changed in settings
      const savedShortcut = await window.faria.settings.get('agentSwitchShortcut');
      if (savedShortcut) {
        setAgentSwitchShortcut(savedShortcut);
      }
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
  const switchMode = useCallback((newMode: 'agent' | 'inline') => {
    if (isProcessing) return;
    // Check if the target mode is available
    if (newMode === 'agent' && !modelAvailability.agentAvailable) return;
    if (newMode === 'inline' && !modelAvailability.inlineAvailable) return;
    setMode(newMode);
    window.faria.commandBar.setMode(newMode);
  }, [isProcessing, modelAvailability]);

  // Determine if mode switching is allowed
  const canSwitchModes = modelAvailability.agentAvailable && modelAvailability.inlineAvailable;


  const handleSubmit = useCallback(async () => {
    if (!query.trim() || isProcessing || mode === 'detecting') return;

    setIsProcessing(true);
    setResponse('');

    try {
      if (mode === 'agent') {
        setStatus('Extracting state...');
        const result = await window.faria.agent.submit(query);
        if (result.success && result.result) {
          setResponse(result.result);
          // History is saved in the agent loop, no need to add here
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
    // Mode switching is handled by global shortcut (Cmd+Shift+/)
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
    // Resizing is handled by useLayoutEffect when query changes
  };

  const handleStop = useCallback(async () => {
    if (!isProcessing) return;
    await window.faria.agent.cancel();
    setIsProcessing(false);
    setStatus('');
  }, [isProcessing]);

  const modeName = mode === 'agent' ? 'Agent' : mode === 'inline' ? 'Inline' : 'Agent';
  const placeholder = mode === 'detecting' ? '...' : mode === 'agent' ? 'Take action...' : 'Edit or ask about selection...';

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
          {/* Mode selector - only show if both models are available and not detecting */}
          {canSwitchModes && mode !== 'detecting' && (
            <button
              className="mode-selector-trigger"
              onClick={() => switchMode(mode === 'agent' ? 'inline' : 'agent')}
              disabled={isProcessing}
            >
              <span className="mode-shortcut-hint">{shortcutToDisplay(agentSwitchShortcut)}</span>
              <span>{modeName}</span>
            </button>
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
              disabled={!query.trim() || mode === 'detecting'}
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
