import React, { useState, useEffect, useCallback } from 'react';

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

interface CustomPalette {
  name: string;
  background: string;
  text: string;
  accent: string;
}

// Helper function to derive accent-hover and accent-active conservatively
const deriveAccentColors = (accent: string): { hover: string; active: string } => {
  // Convert hex to RGB
  const hex = accent.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  // Calculate brightness
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  
  // For lighter colors, darken; for darker colors, lighten
  // Conservative adjustments: ±15% brightness
  const hoverFactor = brightness > 128 ? 0.85 : 1.15;
  const activeFactor = brightness > 128 ? 0.75 : 1.25;
  
  const hoverR = Math.min(255, Math.max(0, Math.round(r * hoverFactor)));
  const hoverG = Math.min(255, Math.max(0, Math.round(g * hoverFactor)));
  const hoverB = Math.min(255, Math.max(0, Math.round(b * hoverFactor)));
  
  const activeR = Math.min(255, Math.max(0, Math.round(r * activeFactor)));
  const activeG = Math.min(255, Math.max(0, Math.round(g * activeFactor)));
  const activeB = Math.min(255, Math.max(0, Math.round(b * activeFactor)));
  
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  
  return {
    hover: `#${toHex(hoverR)}${toHex(hoverG)}${toHex(hoverB)}`,
    active: `#${toHex(activeR)}${toHex(activeG)}${toHex(activeB)}`
  };
};

const MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', provider: 'google' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'google' },
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
const ThemePreview = ({ colors, isSelected, name, onDelete, isHovered }: { colors: { background: string; text: string; accent: string }, isSelected: boolean, name?: string, onDelete?: (e: React.MouseEvent) => void, isHovered?: boolean }) => {
  return (
    <div style={{
      width: '100%',
      height: 52,
      borderRadius: 6,
      overflow: 'hidden',
      background: colors.background,
      position: 'relative',
      boxShadow: isSelected ? `0 0 0 2px ${colors.accent}` : 'none',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      border: `1px solid ${colors.text}26`,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Command bar input area */}
      <div style={{
        flex: 1,
        padding: '8px 12px 4px 12px',
        display: 'flex',
        alignItems: 'center',
      }}>
        <span style={{
          fontSize: 11,
          color: colors.text,
        }}>
          {name || 'Preview'}
        </span>
      </div>

      {/* Command bar footer */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        padding: '2px 8px 6px 8px',
      }}>
        {/* Send button icon */}
        <div style={{
          width: 14,
          height: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: colors.accent,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </div>
      </div>

      {/* Selection indicator (checkmark) */}
      {isSelected && (
        <div style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: colors.accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={colors.background} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}

      {/* Delete button (X) - only shown for custom themes when not selected and hovered */}
      {!isSelected && onDelete && isHovered && (
        <button
          onClick={onDelete}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#ff4444'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(0,0,0,0.6)'; }}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)',
            border: 'none',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            transition: 'background 0.15s ease',
          }}
          title="Delete theme"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
};

function SettingsPanel({ currentTheme, onThemeChange }: SettingsPanelProps) {
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [googleKey, setGoogleKey] = useState('');
  const [showGoogleKey, setShowGoogleKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [customPalettes, setCustomPalettes] = useState<CustomPalette[]>([]);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [hoveredTheme, setHoveredTheme] = useState<string | null>(null);
  const [newPalette, setNewPalette] = useState<CustomPalette>({
    name: '',
    background: '#272932',
    text: '#EAE0D5',
    accent: '#C6AC8F',
  });

  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [hoverAgentModel, setHoverAgentModel] = useState(false);
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
    const savedCustomPalettes = await window.faria.settings.get('customPalettes');
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
    if (savedCustomPalettes) {
      const parsed = JSON.parse(savedCustomPalettes);
      // Migrate old format (primary/secondary/accent) to new format (background/text/accent)
      // Also strip out font property as it's now global
      const migrated = parsed.map((palette: any) => {
          return {
            name: palette.name,
            background: palette.primary || palette.background || '#272932',
            text: palette.secondary || palette.text || '#EAE0D5',
            accent: palette.accent || '#C6AC8F',
        };
      });
      setCustomPalettes(migrated);
      // Save migrated format if it changed
      if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
        await saveSettings('customPalettes', JSON.stringify(migrated));
      }
      
      // If current theme is custom, restore the active custom palette
      if (currentTheme === 'custom') {
        const activePaletteName = await window.faria.settings.get('activeCustomPalette');
        if (activePaletteName) {
          const activePalette = migrated.find((p: CustomPalette) => p.name === activePaletteName);
          if (activePalette) {
            await applyCustomTheme(activePalette);
          }
        } else if (migrated.length > 0) {
          // If no active palette saved, apply the first one
          await applyCustomTheme(migrated[0]);
        }
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

  // Get set of already connected app names
  const connectedAppNames = new Set(connections.map(c => c.appName));

  const filteredApps = availableApps.filter(app =>
    // Exclude already connected apps
    !connectedAppNames.has(app.name) &&
    // Filter by search query
    (app.displayName.toLowerCase().includes(integrationSearch.toLowerCase()) ||
    app.name.toLowerCase().includes(integrationSearch.toLowerCase()))
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

  const handleAddCustomPalette = async () => {
    if (!newPalette.name.trim()) return;
    
    const updated = [...customPalettes, newPalette];
    setCustomPalettes(updated);
    await saveSettings('customPalettes', JSON.stringify(updated));
    
    // Apply the new theme immediately
    applyCustomTheme(newPalette);
    
    // Reset form with current theme values (which is now the newly created theme)
    const currentValues = getCurrentThemeValues();
    setNewPalette({
      name: '',
      background: currentValues.background,
      text: currentValues.text,
      accent: currentValues.accent,
    });
    setShowCustomForm(false);
  };

  const handleDeleteCustomPalette = async (index: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent applying the theme when clicking delete
    const deletedPalette = customPalettes[index];
    const updated = customPalettes.filter((_, i) => i !== index);
    setCustomPalettes(updated);
    await saveSettings('customPalettes', JSON.stringify(updated));
    setSaveStatus('Theme deleted');
    setTimeout(() => setSaveStatus(null), 1500);
    
    // If deleted theme was active, switch to default or another custom theme
    if (currentTheme === 'custom') {
      const activePaletteName = await window.faria.settings.get('activeCustomPalette');
      if (activePaletteName === deletedPalette.name) {
        // Deleted theme was active
        if (updated.length > 0) {
          // Switch to first remaining custom theme
          await applyCustomTheme(updated[0]);
        } else {
          // No custom themes left, switch to default
          onThemeChange('default');
        }
      }
    }
  };

  const applyPresetTheme = async (themeId: string) => {
    const theme = PRESET_THEMES.find(t => t.id === themeId);
    if (!theme) return;

    const { colors } = theme;
    const accentColors = deriveAccentColors(colors.accent);

    // Set base colors
    document.documentElement.style.setProperty('--color-primary', colors.background);
    document.documentElement.style.setProperty('--color-secondary', colors.text);
    document.documentElement.style.setProperty('--color-accent', colors.accent);

    // Derive and set additional colors
    const bgHex = colors.background.replace('#', '');
    const bgR = parseInt(bgHex.substring(0, 2), 16);
    const bgG = parseInt(bgHex.substring(2, 4), 16);
    const bgB = parseInt(bgHex.substring(4, 6), 16);

    const lightR = Math.min(255, Math.round(bgR * 1.2));
    const lightG = Math.min(255, Math.round(bgG * 1.2));
    const lightB = Math.min(255, Math.round(bgB * 1.2));
    const darkR = Math.max(0, Math.round(bgR * 0.7));
    const darkG = Math.max(0, Math.round(bgG * 0.7));
    const darkB = Math.max(0, Math.round(bgB * 0.7));

    const toHex = (n: number) => n.toString(16).padStart(2, '0');

    document.documentElement.style.setProperty('--color-primary-light', `#${toHex(lightR)}${toHex(lightG)}${toHex(lightB)}`);
    document.documentElement.style.setProperty('--color-primary-dark', `#${toHex(darkR)}${toHex(darkG)}${toHex(darkB)}`);
    document.documentElement.style.setProperty('--color-secondary-muted', colors.text + 'B3');
    document.documentElement.style.setProperty('--color-accent-hover', accentColors.hover);
    document.documentElement.style.setProperty('--color-accent-active', accentColors.active);

    // Set UI colors
    document.documentElement.style.setProperty('--color-background', colors.background);
    document.documentElement.style.setProperty('--color-surface', `#${toHex(lightR)}${toHex(lightG)}${toHex(lightB)}`);
    document.documentElement.style.setProperty('--color-text', colors.text);
    document.documentElement.style.setProperty('--color-text-muted', colors.text + 'B3');
    document.documentElement.style.setProperty('--color-border', colors.text + '26');
    document.documentElement.style.setProperty('--color-hover', colors.text + '14');

    document.documentElement.setAttribute('data-theme', themeId);

    onThemeChange(themeId);
  };
  
  const applyCustomTheme = async (palette: CustomPalette) => {
    const accentColors = deriveAccentColors(palette.accent);
    
    // Set base colors
    document.documentElement.style.setProperty('--color-primary', palette.background);
    document.documentElement.style.setProperty('--color-secondary', palette.text);
    document.documentElement.style.setProperty('--color-accent', palette.accent);
    
    // Derive and set additional colors
    // Calculate primary-light and primary-dark from background
    const bgHex = palette.background.replace('#', '');
    const bgR = parseInt(bgHex.substring(0, 2), 16);
    const bgG = parseInt(bgHex.substring(2, 4), 16);
    const bgB = parseInt(bgHex.substring(4, 6), 16);
    
    const lightR = Math.min(255, Math.round(bgR * 1.2));
    const lightG = Math.min(255, Math.round(bgG * 1.2));
    const lightB = Math.min(255, Math.round(bgB * 1.2));
    const darkR = Math.max(0, Math.round(bgR * 0.7));
    const darkG = Math.max(0, Math.round(bgG * 0.7));
    const darkB = Math.max(0, Math.round(bgB * 0.7));
    
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    
    document.documentElement.style.setProperty('--color-primary-light', `#${toHex(lightR)}${toHex(lightG)}${toHex(lightB)}`);
    document.documentElement.style.setProperty('--color-primary-dark', `#${toHex(darkR)}${toHex(darkG)}${toHex(darkB)}`);
    document.documentElement.style.setProperty('--color-secondary-muted', palette.text + 'B3'); // ~70% opacity
    document.documentElement.style.setProperty('--color-accent-hover', accentColors.hover);
    document.documentElement.style.setProperty('--color-accent-active', accentColors.active);
    
    // Set UI colors
    document.documentElement.style.setProperty('--color-background', palette.background);
    document.documentElement.style.setProperty('--color-surface', `#${toHex(lightR)}${toHex(lightG)}${toHex(lightB)}`);
    document.documentElement.style.setProperty('--color-text', palette.text);
    document.documentElement.style.setProperty('--color-text-muted', palette.text + 'B3');
    document.documentElement.style.setProperty('--color-border', palette.text + '26'); // ~15% opacity
    document.documentElement.style.setProperty('--color-hover', palette.text + '14'); // ~8% opacity
    
    document.documentElement.setAttribute('data-theme', 'custom');
    
    // Save which custom palette is active
    await saveSettings('activeCustomPalette', palette.name);
    
    onThemeChange('custom');
  };

  const getCurrentThemeValues = (): { background: string; text: string; accent: string } => {
    if (currentTheme === 'custom') {
      // Get values from CSS variables
      const currentBg = document.documentElement.style.getPropertyValue('--color-primary')?.trim() || 
                       document.documentElement.style.getPropertyValue('--color-background')?.trim() ||
                       '#272932';
      const currentText = document.documentElement.style.getPropertyValue('--color-secondary')?.trim() ||
                         document.documentElement.style.getPropertyValue('--color-text')?.trim() ||
                         '#EAE0D5';
      const currentAccent = document.documentElement.style.getPropertyValue('--color-accent')?.trim() || '#C6AC8F';
      
      return {
        background: currentBg,
        text: currentText,
        accent: currentAccent,
      };
    }
    
    // Get values from preset theme
    const preset = PRESET_THEMES.find(t => t.id === currentTheme);
    if (preset) {
      return {
        background: preset.colors.background,
        text: preset.colors.text,
        accent: preset.colors.accent,
      };
    }
    
    // Fallback to default theme
    return {
      background: PRESET_THEMES[0].colors.background,
      text: PRESET_THEMES[0].colors.text,
      accent: PRESET_THEMES[0].colors.accent,
    };
  };

  const getCurrentThemeInfo = () => {
    if (currentTheme === 'custom') {
      // Find the custom palette that matches current colors
      const currentBg = document.documentElement.style.getPropertyValue('--color-primary')?.trim();
      const currentText = document.documentElement.style.getPropertyValue('--color-secondary')?.trim();
      const currentAccent = document.documentElement.style.getPropertyValue('--color-accent')?.trim();
      
      const matchingPalette = customPalettes.find(p => 
        p.background === currentBg && p.text === currentText && p.accent === currentAccent
      );
      
      if (matchingPalette) {
        return { name: matchingPalette.name, colors: matchingPalette, isCustom: true };
      }
      return { name: 'Custom', colors: { background: currentBg || '#272932', text: currentText || '#EAE0D5', accent: currentAccent || '#C6AC8F' }, isCustom: true };
    }
    
    const preset = PRESET_THEMES.find(t => t.id === currentTheme);
    return preset 
      ? { name: preset.name, colors: preset.colors, isCustom: false }
      : { name: 'Default', colors: PRESET_THEMES[0].colors, isCustom: false };
  };

  // Get the active custom palette name
  const getActiveCustomPaletteName = (): string | null => {
    if (currentTheme !== 'custom') return null;
    const currentBg = document.documentElement.style.getPropertyValue('--color-primary')?.trim();
    const matching = customPalettes.find(p => p.background === currentBg);
    return matching?.name || null;
  };

  return (
    <div className="settings-panel">

      {/* Keyboard Shortcuts Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--spacing-md)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500
        }}>
          Shortcuts
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-sm)',
          marginLeft: 'var(--spacing-md)',
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
            marginBottom: 'var(--spacing-md)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 500
          }}>
            Themes
              </div>

                  <div style={{
                    display: 'flex',
                    gap: 'var(--spacing-sm)',
                    flexWrap: 'wrap',
                    marginLeft: 'var(--spacing-md)',
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
            {/* Custom Themes */}
            {customPalettes.map((palette, index) => {
              const isSelected = currentTheme === 'custom' && getActiveCustomPaletteName() === palette.name;
              const isHovered = hoveredTheme === `custom-${index}`;

              return (
                <div
                  key={`custom-${index}`}
                  onClick={() => applyCustomTheme(palette)}
                  onMouseEnter={() => setHoveredTheme(`custom-${index}`)}
                  onMouseLeave={() => setHoveredTheme(null)}
                  style={{
                    width: 'calc((100% - 4 * var(--spacing-sm)) / 5)',
                    cursor: 'pointer',
                    transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                    transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  <ThemePreview
                    colors={{ background: palette.background, text: palette.text, accent: palette.accent }}
                    isSelected={isSelected}
                    name={palette.name}
                    onDelete={(e) => handleDeleteCustomPalette(index, e)}
                    isHovered={isHovered}
                  />
                </div>
              );
            })}
            {/* Create Custom Theme Button */}
            <div
              onClick={() => {
                const currentValues = getCurrentThemeValues();
                setNewPalette({
                  name: '',
                  background: currentValues.background,
                  text: currentValues.text,
                  accent: currentValues.accent,
                });
                setShowCustomForm(true);
              }}
              onMouseEnter={() => setHoveredTheme('create-custom')}
              onMouseLeave={() => setHoveredTheme(null)}
              style={{
                width: 'calc((100% - 4 * var(--spacing-sm)) / 5)',
                height: 52,
                borderRadius: 6,
                border: '1px solid var(--color-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transform: hoveredTheme === 'create-custom' ? 'translateY(-2px)' : 'translateY(0)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                opacity: hoveredTheme === 'create-custom' ? 1 : 0.6,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
          </div>
        </div>


      </section>

      {/* Agent Model Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--spacing-md)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500
        }}>
          Agent Model
        </div>

        <div style={{ marginLeft: 'var(--spacing-md)' }}>
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
          marginBottom: 'var(--spacing-md)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500
        }}>
          API Keys
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-md)',
          marginLeft: 'var(--spacing-md)',
        }}>
          <div>
            <label style={{
              display: 'block',
              fontSize: 'var(--font-size-sm)',
              marginBottom: 'var(--spacing-xs)',
              color: 'var(--color-text-muted)'
            }}>
              Anthropic API Key
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
              Google AI API Key
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
          marginBottom: 'var(--spacing-md)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500
        }}>
          Tools
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-sm)',
          marginLeft: 'var(--spacing-md)',
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
                padding: 'var(--spacing-sm) 0',
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
                  width: toolSettings[tool.key] === 'auto-approve' ? 'auto' : toolSettings[tool.key] === 'disabled' ? 80 : 72,
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
          marginBottom: 'var(--spacing-md)'
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

        <div style={{ marginLeft: 'var(--spacing-md)' }}>
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
                  <span style={{ fontSize: 'var(--font-size-sm)' }}>{conn.displayName}</span>
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

      {/* Create Custom Theme Modal */}
      {showCustomForm && (
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
            setShowCustomForm(false);
            const currentValues = getCurrentThemeValues();
            setNewPalette({
              name: '',
              background: currentValues.background,
              text: currentValues.text,
              accent: currentValues.accent,
            });
          }}
        >
          <div
            style={{
              background: 'var(--color-primary)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              width: '90%',
              maxWidth: 400,
              padding: 'var(--spacing-lg)',
              cursor: 'default',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Live Preview */}
            <div style={{ marginBottom: 'var(--spacing-lg)' }}>
              <div style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
                marginBottom: 'var(--spacing-sm)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Preview
              </div>
              <ThemePreview
                colors={{ background: newPalette.background, text: newPalette.text, accent: newPalette.accent }}
                isSelected={false}
                name={newPalette.name || 'Preview'}
              />
            </div>

            {/* Theme Name */}
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
              <label style={{
                display: 'block',
                fontSize: 'var(--font-size-xs)',
                marginBottom: 'var(--spacing-xs)',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>
                Name
              </label>
              <input
                type="text"
                value={newPalette.name}
                onChange={(e) => setNewPalette({ ...newPalette, name: e.target.value })}
                placeholder="My Custom Theme"
                autoFocus
                style={{
                  width: '100%',
                  padding: 'var(--spacing-sm) var(--spacing-md)',
                  fontSize: 'var(--font-size-sm)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text)',
                }}
              />
            </div>

            {/* Color Pickers Row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 'var(--spacing-md)',
              marginBottom: 'var(--spacing-md)'
            }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: 'var(--font-size-xs)',
                  marginBottom: 'var(--spacing-xs)',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Background
                </label>
                <input
                  type="color"
                  value={newPalette.background}
                  onChange={(e) => setNewPalette({ ...newPalette, background: e.target.value })}
                  style={{
                    width: '100%',
                    height: 44,
                    padding: 0,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    outline: 'none',
                    WebkitAppearance: 'none',
                    appearance: 'none',
                    backgroundColor: 'transparent',
                    colorScheme: 'dark',
                  }}
                />
              </div>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: 'var(--font-size-xs)',
                  marginBottom: 'var(--spacing-xs)',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Text
                </label>
                <input
                  type="color"
                  value={newPalette.text}
                  onChange={(e) => setNewPalette({ ...newPalette, text: e.target.value })}
                  style={{
                    width: '100%',
                    height: 44,
                    padding: 0,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    outline: 'none',
                    WebkitAppearance: 'none',
                    appearance: 'none',
                    backgroundColor: 'transparent',
                    colorScheme: 'dark',
                  }}
                />
              </div>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: 'var(--font-size-xs)',
                  marginBottom: 'var(--spacing-xs)',
                  color: 'var(--color-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em'
                }}>
                  Accent
                </label>
                <input
                  type="color"
                  value={newPalette.accent}
                  onChange={(e) => setNewPalette({ ...newPalette, accent: e.target.value })}
                  style={{
                    width: '100%',
                    height: 44,
                    padding: 0,
                    cursor: 'pointer',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    outline: 'none',
                    WebkitAppearance: 'none',
                    appearance: 'none',
                    backgroundColor: 'transparent',
                    colorScheme: 'dark',
                  }}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowCustomForm(false);
                  const currentValues = getCurrentThemeValues();
                  setNewPalette({
                    name: '',
                    background: currentValues.background,
                    text: currentValues.text,
                    accent: currentValues.accent,
                  });
                }}
                style={{
                  padding: 'var(--spacing-sm) var(--spacing-lg)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                Cancel
              </button>
              <button
                className="btn"
                onClick={handleAddCustomPalette}
                disabled={!newPalette.name.trim()}
                style={{
                  padding: 'var(--spacing-sm) var(--spacing-lg)',
                  borderRadius: 'var(--radius-md)',
                  opacity: !newPalette.name.trim() ? 0.5 : 1,
                }}
              >
                Create Theme
              </button>
            </div>
          </div>
        </div>
      )}

      {/* System Prompt Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-muted)',
          marginBottom: 'var(--spacing-md)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 500
        }}>
          System Prompt
        </div>

        <div style={{ marginLeft: 'var(--spacing-md)' }}>
          <textarea
            value={agentPrompt}
            onChange={(e) => {
              setAgentPrompt(e.target.value);
              saveSettings('agentSystemPrompt', e.target.value);
            }}
            placeholder="Enter custom agent system prompt..."
            style={{
              width: '100%',
              height: 300,
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

