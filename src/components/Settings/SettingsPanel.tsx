import React, { useState, useEffect } from 'react';

interface SettingsPanelProps {
  currentTheme: string;
  onThemeChange: (theme: string) => void;
}

// Default shortcuts
const DEFAULT_COMMAND_BAR_SHORTCUT = 'CommandOrControl+Enter';
const DEFAULT_RESET_COMMAND_BAR_SHORTCUT = 'CommandOrControl+Shift+Enter';
const DEFAULT_MOVE_PREFIX = 'CommandOrControl+Alt';
const DEFAULT_TRANSPARENCY_PREFIX = 'CommandOrControl+Control';

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
    .replace('Enter', '↵')
    .toUpperCase()
    .replace('⌘', '⌘')
    .replace('⇧', '⇧')
    .replace('⌃', '⌃')
    .replace('⌥', '⌥')
    .replace('↵', '↵');
};

// Convert keyboard event to Electron accelerator format
const eventToAccelerator = (e: KeyboardEvent): string | null => {
  // Ignore modifier-only keypresses
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) {
    return null;
  }

  const parts: string[] = [];

  if (e.metaKey || e.ctrlKey) {
    parts.push('CommandOrControl');
  }
  if (e.shiftKey) {
    parts.push('Shift');
  }
  if (e.altKey) {
    parts.push('Alt');
  }

  // Need at least one modifier
  if (parts.length === 0) {
    return null;
  }

  // Map key to Electron format
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (key === 'ArrowUp') key = 'Up';
  else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left';
  else if (key === 'ArrowRight') key = 'Right';

  parts.push(key);

  return parts.join('+');
};

// Convert keyboard event to modifier prefix only (for move/transparency shortcuts)
const eventToModifierPrefix = (e: KeyboardEvent): string | null => {
  // Only capture when a non-modifier key is pressed to confirm the prefix
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) {
    return null;
  }

  const parts: string[] = [];

  if (e.metaKey) {
    parts.push('Command');
  }
  if (e.ctrlKey) {
    parts.push('Control');
  }
  if (e.shiftKey) {
    parts.push('Shift');
  }
  if (e.altKey) {
    parts.push('Alt');
  }

  // Need at least one modifier
  if (parts.length === 0) {
    return null;
  }

  return parts.join('+');
};

// Convert modifier prefix to display format
const prefixToDisplay = (prefix: string): string => {
  return prefix
    .replace('CommandOrControl', '⌘')
    .replace('Command', '⌘')
    .replace('Control', '⌃')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace('Option', '⌥')
    .replace(/\+/g, '');
};


const MODELS = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', provider: 'anthropic' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', provider: 'anthropic' },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4.5', provider: 'anthropic' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'google' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', provider: 'google' },
  { id: 'gemini-3-flash-preview', name: '★ Gemini 3 Flash', provider: 'google' },
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', provider: 'google' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
];

const PRESET_THEMES = [
  {
    id: 'default',
    name: 'Chateau',
    colors: { background: '#272932', text: '#EAE0D5', accent: '#C6AC8F' },
  },
  {
    id: 'comte',
    name: 'Comte',
    colors: { background: '#07020D', text: '#FBFFFE', accent: '#3C91E6' },
  },
  {
    id: 'mercedes',
    name: 'Mercédès',
    colors: { background: '#46494C', text: '#DCDCDD', accent: '#9883E5' },
  },
  {
    id: 'carnival',
    name: 'Carnival',
    colors: { background: '#001011', text: '#6CCFF6', accent: '#E94560' },
  },
];



// Mini command bar preview component for theme cards
const ThemePreview = ({ colors, isSelected, name }: { colors: { background: string; text: string; accent: string }, isSelected: boolean, name?: string }) => {
  return (
    <div style={{
      width: '100%',
      height: 32,
      borderRadius: 6,
      background: colors.background,
      position: 'relative',
      boxShadow: isSelected ? `0 0 0 2px ${colors.accent}` : 'none',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      border: `1px solid ${colors.text}26`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 8px',
    }}>
      <span style={{
        flex: 1,
        fontSize: 10,
        color: colors.text,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}>
        {name || 'Preview'}
      </span>
      <div style={{
        width: 12,
        height: 12,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.accent,
        marginLeft: 4,
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </div>
    </div>
  );
};

function SettingsPanel({ currentTheme, onThemeChange }: SettingsPanelProps) {
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [googleKey, setGoogleKey] = useState('');
  const [showGoogleKey, setShowGoogleKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [hoveredTheme, setHoveredTheme] = useState<string | null>(null);

  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [hoverAgentModel, setHoverAgentModel] = useState(false);
  const [commandBarSize, setCommandBarSize] = useState<'small' | 'medium' | 'large'>('small');
  const [agentPrompt, setAgentPrompt] = useState('');

  // Tool settings - 'enabled' | 'disabled' | 'auto-approve'
  type ToolSetting = 'enabled' | 'disabled' | 'auto-approve';
  const [toolSettings, setToolSettings] = useState<Record<string, ToolSetting>>({
    screenshot: 'enabled',
    typing: 'enabled',
    replaceText: 'enabled',
    insertImage: 'enabled',
    clicking: 'enabled',
    scrolling: 'enabled',
    integrations: 'enabled',
  });

  // Keyboard shortcuts
  const [commandBarShortcut, setCommandBarShortcut] = useState(DEFAULT_COMMAND_BAR_SHORTCUT);
  const [resetCommandBarShortcut, setResetCommandBarShortcut] = useState(DEFAULT_RESET_COMMAND_BAR_SHORTCUT);
  const [movePrefix, setMovePrefix] = useState(DEFAULT_MOVE_PREFIX);
  const [transparencyPrefix, setTransparencyPrefix] = useState(DEFAULT_TRANSPARENCY_PREFIX);
  const [recordingShortcut, setRecordingShortcut] = useState<'commandBar' | 'resetCommandBar' | 'movePrefix' | 'transparencyPrefix' | null>(null);

  // Integrations state
  const [connections, setConnections] = useState<Array<{
    id: string;
    appName: string;
    displayName: string;
    status: string;
    logo?: string;
    createdAt?: string;
    accountLabel?: string;
  }>>([]);
  const [availableApps, setAvailableApps] = useState<Array<{
    name: string;
    displayName: string;
    logo?: string;
    categories?: string[];
  }>>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [showAddIntegrationModal, setShowAddIntegrationModal] = useState(false);
  const [integrationSearch, setIntegrationSearch] = useState('');
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  useEffect(() => {
    loadSettings().then(() => {
      setHasLoadedSettings(true);
    });
  }, []);

  // Re-validate models when API keys change (but only after initial load)
  useEffect(() => {
    if (!hasLoadedSettings) return;

    const availableModels = getAvailableModels();
    const availableModelIds = availableModels.map(m => m.id);

    // If selected model is not "none" and not available, reset to "none"
    if (selectedModel !== 'none' && !availableModelIds.includes(selectedModel)) {
      setSelectedModel('none');
      saveSettings('selectedModel', 'none');
    }
  }, [anthropicKey, googleKey, hasLoadedSettings, selectedModel]);

  const loadSettings = async () => {
    const savedAnthropicKey = await window.faria.settings.get('anthropicKey');
    const savedGoogleKey = await window.faria.settings.get('googleKey');
    const savedModel = await window.faria.settings.get('selectedModel');
    const savedAgentPrompt = await window.faria.settings.get('agentSystemPrompt');

    if (savedAnthropicKey) setAnthropicKey(savedAnthropicKey);
    if (savedGoogleKey) setGoogleKey(savedGoogleKey);

    // Load prompt: use saved if available, otherwise load default
    if (savedAgentPrompt) {
      setAgentPrompt(savedAgentPrompt);
    } else {
      const defaultAgentPrompt = await window.faria.settings.getDefaultPrompt();
      setAgentPrompt(defaultAgentPrompt);
    }
    
    // Check which models are available based on saved API keys
    const hasAnthropicKey = savedAnthropicKey && savedAnthropicKey.trim().length > 0;
    const hasGoogleKey = savedGoogleKey && savedGoogleKey.trim().length > 0;
    const availableModelIds = MODELS
      .filter(model => {
        if (model.provider === 'anthropic' && hasAnthropicKey) return true;
        if (model.provider === 'google' && hasGoogleKey) return true;
        return false;
      })
      .map(m => m.id);
    
    // Set model, but validate it's still available (or is "none")
    if (savedModel) {
      if (savedModel === 'none' || availableModelIds.includes(savedModel)) {
        setSelectedModel(savedModel);
      } else {
        // Model no longer available, default to "none"
        setSelectedModel('none');
        saveSettings('selectedModel', 'none');
      }
    }
    // Load keyboard shortcuts
    const savedCommandBarShortcut = await window.faria.settings.get('commandBarShortcut');
    if (savedCommandBarShortcut) setCommandBarShortcut(savedCommandBarShortcut);

    const savedResetCommandBarShortcut = await window.faria.settings.get('resetCommandBarShortcut');
    if (savedResetCommandBarShortcut) setResetCommandBarShortcut(savedResetCommandBarShortcut);

    const savedMovePrefix = await window.faria.settings.get('moveShortcutPrefix');
    if (savedMovePrefix) setMovePrefix(savedMovePrefix);

    const savedTransparencyPrefix = await window.faria.settings.get('transparencyShortcutPrefix');
    if (savedTransparencyPrefix) setTransparencyPrefix(savedTransparencyPrefix);

    // Load command bar size
    const savedSize = await window.faria.settings.get('commandBarSize');
    if (savedSize === 'small' || savedSize === 'medium' || savedSize === 'large') setCommandBarSize(savedSize);

    // Load tool settings
    const savedToolSettings = await window.faria.settings.get('toolSettings');
    if (savedToolSettings) {
      try {
        const parsed = JSON.parse(savedToolSettings);
        setToolSettings(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error('Failed to parse tool settings:', e);
      }
    }
  };

  // Keyboard shortcut recording
  useEffect(() => {
    if (!recordingShortcut) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // For prefix shortcuts, capture just the modifiers
      if (recordingShortcut === 'movePrefix' || recordingShortcut === 'transparencyPrefix') {
        const prefix = eventToModifierPrefix(e);
        if (!prefix) return; // Modifier-only press, keep recording

        if (recordingShortcut === 'movePrefix') {
          setMovePrefix(prefix);
          saveSettings('moveShortcutPrefix', prefix);
          window.faria.settings.set('moveShortcutPrefix', prefix).then(() => {
            window.faria.shortcuts?.reregister();
          });
        } else if (recordingShortcut === 'transparencyPrefix') {
          setTransparencyPrefix(prefix);
          saveSettings('transparencyShortcutPrefix', prefix);
          window.faria.settings.set('transparencyShortcutPrefix', prefix).then(() => {
            window.faria.shortcuts?.reregister();
          });
        }

        setRecordingShortcut(null);
        return;
      }

      const accelerator = eventToAccelerator(e);
      if (!accelerator) return; // Modifier-only press, keep recording

      if (recordingShortcut === 'commandBar') {
        setCommandBarShortcut(accelerator);
        saveSettings('commandBarShortcut', accelerator);
        window.faria.settings.set('commandBarShortcut', accelerator).then(() => {
          window.faria.shortcuts?.reregister();
        });
      } else if (recordingShortcut === 'resetCommandBar') {
        setResetCommandBarShortcut(accelerator);
        saveSettings('resetCommandBarShortcut', accelerator);
        window.faria.settings.set('resetCommandBarShortcut', accelerator).then(() => {
          window.faria.shortcuts?.reregister();
        });
      }

      setRecordingShortcut(null);
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setRecordingShortcut(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleEscape, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleEscape, true);
    };
  }, [recordingShortcut]);

  // Load integrations on mount
  useEffect(() => {
    loadIntegrations();
  }, []);

  const loadIntegrations = async () => {
    setIntegrationsLoading(true);
    try {
      const [conns, apps] = await Promise.all([
        window.faria.integrations.getConnections(),
        window.faria.integrations.getAvailableApps()
      ]);
      setConnections(conns);
      setAvailableApps(apps);
    } catch (error) {
      console.error('Failed to load integrations:', error);
    } finally {
      setIntegrationsLoading(false);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    setDisconnectingId(connectionId);
    try {
      const success = await window.faria.integrations.deleteConnection(connectionId);
      if (success) {
        setConnections(prev => prev.filter(c => c.id !== connectionId));
      }
    } catch (error) {
      console.error('Failed to disconnect:', error);
    } finally {
      setDisconnectingId(null);
    }
  };

  const handleConnect = async (appName: string) => {
    setConnectingApp(appName);
    try {
      const result = await window.faria.integrations.initiateConnection(appName);
      if (result?.redirectUrl) {
        window.faria.shell.openExternal(result.redirectUrl);
        // Close modal after opening auth URL
        setShowAddIntegrationModal(false);
        setIntegrationSearch('');
        // Refresh connections after a delay to allow OAuth to complete
        setTimeout(() => loadIntegrations(), 3000);
      }
    } catch (error) {
      console.error('Failed to initiate connection:', error);
    } finally {
      setConnectingApp(null);
    }
  };

  const filteredApps = availableApps.filter(app =>
    app.displayName.toLowerCase().includes(integrationSearch.toLowerCase()) ||
    app.name.toLowerCase().includes(integrationSearch.toLowerCase())
  );

  // Get available models based on API keys
  const getAvailableModels = () => {
    const available: typeof MODELS = [];
    
    // Check if Anthropic key is available
    const hasAnthropicKey = anthropicKey && anthropicKey.trim().length > 0;
    // Check if Google key is available
    const hasGoogleKey = googleKey && googleKey.trim().length > 0;
    
    MODELS.forEach(model => {
      if (model.provider === 'anthropic' && hasAnthropicKey) {
        available.push(model);
      } else if (model.provider === 'google' && hasGoogleKey) {
        available.push(model);
      }
    });
    
    return available;
  };

  const saveSettings = async (key: string, value: string) => {
    try {
      await window.faria.settings.set(key, value);
      setSaveStatus('Saved!');
      setTimeout(() => setSaveStatus(null), 1500);
    } catch (error) {
      setSaveStatus('Error saving');
      setTimeout(() => setSaveStatus(null), 2000);
    }
  };

  const applyPresetTheme = (themeId: string) => {
    // Clear any legacy inline color overrides so CSS [data-theme] selectors take effect
    const colorProps = [
      '--color-primary', '--color-secondary', '--color-accent',
      '--color-primary-light', '--color-primary-dark',
      '--color-secondary-muted', '--color-accent-hover', '--color-accent-active',
      '--color-background', '--color-surface', '--color-text', '--color-text-muted',
      '--color-border', '--color-hover',
    ];
    for (const prop of colorProps) {
      document.documentElement.style.removeProperty(prop);
    }
    document.documentElement.setAttribute('data-theme', themeId === 'default' ? '' : themeId);
    onThemeChange(themeId);
  };

  return (
    <div className="settings-panel">

      {/* Keyboard Shortcuts Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--spacing-sm)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500,
          paddingLeft: 'var(--spacing-sm)',
          paddingTop: 'var(--spacing-sm)',
          paddingBottom: 'var(--spacing-sm)',
        }}>
          Shortcuts
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-sm)',
          marginLeft: 'calc(var(--spacing-md) * 2)',
        }}>
          {/* Command Bar Toggle */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-sm)',
            padding: 'var(--spacing-sm) 0',
          }}>
            <button
              onClick={() => setRecordingShortcut('commandBar')}
              style={{
                padding: 'var(--spacing-xs) var(--spacing-md)',
                fontSize: 'var(--font-size-sm)',
                fontFamily: 'system-ui',
                background: recordingShortcut === 'commandBar' ? 'var(--color-accent)' : 'var(--color-background)',
                color: recordingShortcut === 'commandBar' ? 'var(--color-background)' : 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                minWidth: 80,
                transition: 'all 0.15s ease',
              }}
            >
              {recordingShortcut === 'commandBar' ? 'Press keys...' : shortcutToDisplay(commandBarShortcut)}
            </button>
            <span style={{ fontSize: 'var(--font-size-sm)' }}>Open</span>
          </div>

          {/* Reset Command Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-sm)',
            padding: 'var(--spacing-sm) 0',
          }}>
            <button
              onClick={() => setRecordingShortcut('resetCommandBar')}
              style={{
                padding: 'var(--spacing-xs) var(--spacing-md)',
                fontSize: 'var(--font-size-sm)',
                fontFamily: 'system-ui',
                background: recordingShortcut === 'resetCommandBar' ? 'var(--color-accent)' : 'var(--color-background)',
                color: recordingShortcut === 'resetCommandBar' ? 'var(--color-background)' : 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                minWidth: 80,
                transition: 'all 0.15s ease',
              }}
            >
              {recordingShortcut === 'resetCommandBar' ? 'Press keys...' : shortcutToDisplay(resetCommandBarShortcut)}
            </button>
            <span style={{ fontSize: 'var(--font-size-sm)' }}>Reset</span>
          </div>

          {/* Move Faria Bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-sm)',
            padding: 'var(--spacing-sm) 0',
          }}>
            <button
              onClick={() => setRecordingShortcut('movePrefix')}
              style={{
                padding: 'var(--spacing-xs) var(--spacing-md)',
                fontSize: 'var(--font-size-sm)',
                fontFamily: 'system-ui',
                background: recordingShortcut === 'movePrefix' ? 'var(--color-accent)' : 'var(--color-background)',
                color: recordingShortcut === 'movePrefix' ? 'var(--color-background)' : 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                minWidth: 80,
                transition: 'all 0.15s ease',
              }}
            >
              {recordingShortcut === 'movePrefix' ? 'Press keys...' : prefixToDisplay(movePrefix)}
            </button>
            <span style={{ fontSize: 'var(--font-size-sm)' }}>Move</span>
          </div>

          {/* Transparency */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-sm)',
            padding: 'var(--spacing-sm) 0',
          }}>
            <button
              onClick={() => setRecordingShortcut('transparencyPrefix')}
              style={{
                padding: 'var(--spacing-xs) var(--spacing-md)',
                fontSize: 'var(--font-size-sm)',
                fontFamily: 'system-ui',
                background: recordingShortcut === 'transparencyPrefix' ? 'var(--color-accent)' : 'var(--color-background)',
                color: recordingShortcut === 'transparencyPrefix' ? 'var(--color-background)' : 'var(--color-text)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                minWidth: 80,
                transition: 'all 0.15s ease',
              }}
            >
              {recordingShortcut === 'transparencyPrefix' ? 'Press keys...' : prefixToDisplay(transparencyPrefix)}
            </button>
            <span style={{ fontSize: 'var(--font-size-sm)' }}>Transparency</span>
          </div>
        </div>
      </section>

      {/* Theme Section - Redesigned */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>


        {/* Preset Themes Grid */}
        <div style={{ marginBottom: 'var(--spacing-lg)' }}>
          <div style={{
            fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-muted)',
            marginBottom: 'var(--spacing-sm)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 500,
            paddingLeft: 'var(--spacing-sm)',
            paddingTop: 'var(--spacing-sm)',
            paddingBottom: 'var(--spacing-sm)',
          }}>
            Themes
              </div>

                  <div style={{
                    display: 'flex',
                    gap: 'var(--spacing-sm)',
                    flexWrap: 'wrap',
                    marginLeft: 'calc(var(--spacing-md) * 2)',
                  }}>
            {PRESET_THEMES.map((theme) => {
              const isSelected = currentTheme === theme.id;
              const isHovered = hoveredTheme === theme.id;

              return (
                      <div
                        key={theme.id}
                  onClick={() => applyPresetTheme(theme.id)}
                  onMouseEnter={() => setHoveredTheme(theme.id)}
                  onMouseLeave={() => setHoveredTheme(null)}
                        style={{
                          width: 'calc((100% - 4 * var(--spacing-sm)) / 5)',
                          cursor: 'pointer',
                    transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                    transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  <ThemePreview colors={theme.colors} isSelected={isSelected} name={theme.name} />
                </div>
              );
            })}
          </div>
        </div>


      </section>

      {/* Command Bar Size Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--spacing-sm)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500,
          paddingLeft: 'var(--spacing-sm)',
          paddingTop: 'var(--spacing-sm)',
          paddingBottom: 'var(--spacing-sm)',
        }}>
          Size
        </div>
        <div style={{ marginLeft: 'calc(var(--spacing-md) * 2)' }}>
          {(() => {
            const sizes = ['small', 'medium', 'large'] as const;
            const labels: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
            const specs: Record<string, { w: number; h: number; fontSize: number; radius: number; iconSize: number; padV: number; padH: number }> = {
              small:  { w: 300, h: 39, fontSize: 13, radius: 6, iconSize: 13, padV: 8, padH: 16 },
              medium: { w: 375, h: 47, fontSize: 16, radius: 8, iconSize: 16, padV: 10, padH: 20 },
              large:  { w: 450, h: 56, fontSize: 20, radius: 9, iconSize: 20, padV: 12, padH: 24 },
            };
            const { w, h, fontSize, radius, iconSize, padV, padH } = specs[commandBarSize];

            return (
              <div
                onClick={() => {
                  const nextIndex = (sizes.indexOf(commandBarSize) + 1) % sizes.length;
                  const nextSize = sizes[nextIndex];
                  setCommandBarSize(nextSize);
                  saveSettings('commandBarSize', nextSize);
                }}
                style={{
                  width: w,
                  height: h,
                  borderRadius: radius,
                  background: 'var(--color-background)',
                  border: '1px solid var(--color-border)',
                  boxShadow: 'none',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  padding: `${padV}px ${padH}px`,
                  cursor: 'pointer',
                  transform: hoveredTheme === 'size-preview' ? 'translateY(-2px)' : 'translateY(0)',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                onMouseEnter={() => setHoveredTheme('size-preview')}
                onMouseLeave={() => setHoveredTheme(null)}
              >
                <span style={{
                  fontSize,
                  lineHeight: 1.5,
                  color: 'var(--color-text)',
                }}>
                  {labels[commandBarSize]}
                </span>
                <svg
                  style={{ marginTop: Math.round((fontSize * 1.5 - iconSize) / 2) }}
                  width={iconSize}
                  height={iconSize}
                  viewBox="0 0 24 24"
                  fill="var(--color-accent)"
                >
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </div>
            );
          })()}
        </div>
      </section>

      {/* Agent Model Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--spacing-sm)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500,
          paddingLeft: 'var(--spacing-sm)',
          paddingTop: 'var(--spacing-sm)',
          paddingBottom: 'var(--spacing-sm)',
        }}>
          Agent Model
        </div>

        <div style={{ marginLeft: 'calc(var(--spacing-md) * 2)' }}>
          <select
            value={selectedModel}
            onChange={(e) => {
              setSelectedModel(e.target.value);
              saveSettings('selectedModel', e.target.value);
            }}
            onMouseEnter={() => setHoverAgentModel(true)}
            onMouseLeave={() => setHoverAgentModel(false)}
            style={{
              padding: 'var(--spacing-sm)',
              fontSize: 'var(--font-size-sm)',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${hoverAgentModel ? 'var(--color-accent)' : 'var(--color-border)'}`,
              backgroundColor: hoverAgentModel ? 'var(--color-hover)' : 'var(--color-primary)',
              color: 'var(--color-text)',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
          >
            <option value="none">None</option>
            {getAvailableModels().map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* API Keys Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--spacing-sm)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500,
          paddingLeft: 'var(--spacing-sm)',
          paddingTop: 'var(--spacing-sm)',
          paddingBottom: 'var(--spacing-sm)',
        }}>
          API Keys
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-md)',
          marginLeft: 'calc(var(--spacing-md) * 2)',
        }}>
          <div>
            <label style={{
              display: 'block',
              fontSize: 'var(--font-size-sm)',
              marginBottom: 'var(--spacing-xs)',
              color: 'var(--color-text-muted)'
            }}>
              Anthropic
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showAnthropicKey ? 'text' : 'password'}
                value={anthropicKey}
                onChange={(e) => {
                  setAnthropicKey(e.target.value);
                  saveSettings('anthropicKey', e.target.value);
                }}
                placeholder="sk-ant-..."
                style={{ width: '100%', paddingRight: 36 }}
              />
              <button
                onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  padding: 4,
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {showAnthropicKey ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: 'var(--font-size-sm)',
              marginBottom: 'var(--spacing-xs)',
              color: 'var(--color-text-muted)'
            }}>
              Google AI
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showGoogleKey ? 'text' : 'password'}
                value={googleKey}
                onChange={(e) => {
                  setGoogleKey(e.target.value);
                  saveSettings('googleKey', e.target.value);
                }}
                placeholder="AIxxxx..."
                style={{ width: '100%', paddingRight: 36 }}
              />
              <button
                onClick={() => setShowGoogleKey(!showGoogleKey)}
                style={{
                  position: 'absolute',
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  padding: 4,
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {showGoogleKey ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Tools Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--spacing-sm)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500,
          paddingLeft: 'var(--spacing-sm)',
          paddingTop: 'var(--spacing-sm)',
          paddingBottom: 'var(--spacing-sm)',
        }}>
          Actions
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          marginLeft: 'calc(var(--spacing-md) * 2)',
        }}>
          {[
            { key: 'screenshot', name: 'Screenshots', description: 'Capture screen images' },
            { key: 'typing', name: 'Typing', description: 'Type text and press keys' },
            { key: 'replaceText', name: 'Replace Text', description: 'Replace selected text in apps' },
            { key: 'insertImage', name: 'Insert Image', description: 'Search and insert images' },
            { key: 'clicking', name: 'Clicking', description: 'Click, double-click, and right-click' },
            { key: 'scrolling', name: 'Scrolling & Dragging', description: 'Scroll and drag the mouse' },
            { key: 'integrations', name: 'External Integrations', description: 'Gmail, Slack, GitHub, and other services' },
          ].map(tool => (
            <div
              key={tool.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--spacing-sm)',
                padding: '4px 0',
              }}
            >
              <span style={{ fontSize: 'var(--font-size-sm)' }}>{tool.name}:</span>
              <select
                value={toolSettings[tool.key] || 'enabled'}
                onChange={(e) => {
                  const newSettings = { ...toolSettings, [tool.key]: e.target.value as 'enabled' | 'disabled' | 'auto-approve' };
                  setToolSettings(newSettings);
                  saveSettings('toolSettings', JSON.stringify(newSettings));
                }}
                style={{
                  padding: '2px 4px',
                  fontSize: 'var(--font-size-sm)',
                  fontFamily: 'var(--font-family)',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-primary)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  width: 88,
                }}
              >
                <option value="enabled">Enabled</option>
                <option value="disabled">Disabled</option>
                <option value="auto-approve">Auto-approve</option>
              </select>
            </div>
          ))}
        </div>
      </section>

      {/* Integrations Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-sm)',
          marginBottom: 'var(--spacing-sm)',
          paddingLeft: 'var(--spacing-sm)',
          paddingTop: 'var(--spacing-sm)',
          paddingBottom: 'var(--spacing-sm)',
        }}>
          <div style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 500
          }}>
            Integrations
          </div>
          <span
            onClick={() => setShowAddIntegrationModal(true)}
            style={{
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            +
          </span>
        </div>

        <div style={{ marginLeft: 'calc(var(--spacing-md) * 2)' }}>
          {integrationsLoading ? (
            <div style={{
              padding: 'var(--spacing-sm) 0',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-sm)',
            }}>
              Loading integrations...
            </div>
          ) : connections.length === 0 ? (
            <div style={{
              padding: 'var(--spacing-sm) 0',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-sm)',
            }}>
              No integrations connected yet
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
              {connections.map(conn => (
                <div
                  key={conn.id}
                  className="integration-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-sm)',
                    padding: 'var(--spacing-sm) 0',
                    width: 'fit-content',
                  }}
                >
                  {conn.logo ? (
                    <img
                      src={conn.logo}
                      alt={conn.displayName}
                      style={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 'var(--radius-sm)' }}
                    />
                  ) : (
                    <div style={{
                      width: 20,
                      height: 20,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-primary)',
                      fontWeight: 600,
                    }}>
                      {conn.displayName.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span style={{ fontSize: 'var(--font-size-sm)' }}>
                    {conn.displayName}
                    {conn.accountLabel && (
                      <span style={{ color: 'var(--color-text-muted)', marginLeft: 4 }}>
                        ({conn.accountLabel})
                      </span>
                    )}
                  </span>
                  <span
                    className="integration-delete"
                    onClick={() => handleDisconnect(conn.id)}
                    style={{
                      fontSize: 'var(--font-size-sm)',
                      cursor: 'pointer',
                      opacity: disconnectingId === conn.id ? 0.5 : 0,
                      transition: 'opacity 0.15s ease, color 0.15s ease',
                      color: 'var(--color-text)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#e53935'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text)'; }}
                  >
                    {disconnectingId === conn.id ? '...' : '×'}
                  </span>
                  <style>{`
                    .integration-row:hover .integration-delete {
                      opacity: 1 !important;
                    }
                  `}</style>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Add Integration Modal */}
      {showAddIntegrationModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            cursor: 'pointer',
          }}
          onClick={() => {
            setShowAddIntegrationModal(false);
            setIntegrationSearch('');
          }}
        >
          <div
            style={{
              background: 'var(--color-primary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              width: '90%',
              maxWidth: 500,
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              cursor: 'default',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Search Input */}
            <div style={{ padding: 'var(--spacing-md)' }}>
              <input
                type="text"
                placeholder="Search integrations..."
                value={integrationSearch}
                onChange={e => setIntegrationSearch(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  padding: 'var(--spacing-sm)',
                  fontSize: 'var(--font-size-sm)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text)',
                }}
              />
            </div>

            {/* Apps Grid */}
            <div style={{
              flex: 1,
              overflow: 'auto',
              padding: 'var(--spacing-md)',
            }}>
              {filteredApps.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: 'var(--spacing-lg)',
                  color: 'var(--color-text-muted)'
                }}>
                  {availableApps.length === 0 ? 'No integrations available' : 'No matching integrations'}
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 'var(--spacing-sm)',
                }}>
                  {filteredApps.map(app => (
                    <button
                      key={app.name}
                      onClick={() => handleConnect(app.name)}
                      disabled={connectingApp === app.name}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 'var(--spacing-xs)',
                        padding: 'var(--spacing-md)',
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: connectingApp === app.name ? 'wait' : 'pointer',
                        opacity: connectingApp === app.name ? 0.5 : 1,
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={e => {
                        if (connectingApp !== app.name) {
                          e.currentTarget.style.borderColor = 'var(--color-accent)';
                          e.currentTarget.style.background = 'var(--color-hover)';
                        }
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--color-border)';
                        e.currentTarget.style.background = 'var(--color-surface)';
                      }}
                    >
                      {app.logo ? (
                        <img
                          src={app.logo}
                          alt={app.displayName}
                          style={{ width: 32, height: 32, objectFit: 'contain' }}
                        />
                      ) : (
                        <div style={{
                          width: 32,
                          height: 32,
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--color-accent)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 'var(--font-size-md)',
                          color: 'var(--color-primary)',
                          fontWeight: 600,
                        }}>
                          {app.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--color-text)',
                        textAlign: 'center',
                        wordBreak: 'break-word',
                      }}>
                        {connectingApp === app.name ? 'Connecting...' : app.displayName}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* System Prompt Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--spacing-sm)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500,
          paddingLeft: 'var(--spacing-sm)',
          paddingTop: 'var(--spacing-sm)',
          paddingBottom: 'var(--spacing-sm)',
        }}>
          System Prompt
        </div>

        <div style={{ marginLeft: 'calc(var(--spacing-md) * 2)' }}>
          <textarea
            value={agentPrompt}
            onChange={(e) => {
              setAgentPrompt(e.target.value);
              saveSettings('agentSystemPrompt', e.target.value);
            }}
            placeholder="Enter custom agent system prompt..."
            style={{
              width: '100%',
              height: 120,
              padding: 'var(--spacing-sm)',
              fontSize: 'var(--font-size-sm)',
              fontFamily: 'monospace',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-text)',
              resize: 'none',
              lineHeight: 1.5,
            }}
          />
        </div>
      </section>
    </div>
  );
}

export default SettingsPanel;

