import React, { useState, useEffect } from 'react';

interface SettingsPanelProps {
  currentTheme: string;
  onThemeChange: (theme: string) => void;
}

interface CustomPalette {
  name: string;
  background: string;
  text: string;
  accent: string;
  font?: string;
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
    name: 'Default', 
    colors: { background: '#272932', text: '#EAE0D5', accent: '#C6AC8F' },
    font: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  { 
    id: 'midnight', 
    name: 'Midnight', 
    colors: { background: '#0D1117', text: '#C9D1D9', accent: '#58A6FF' },
    font: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
  { 
    id: 'forest', 
    name: 'Forest', 
    colors: { background: '#1A2F1A', text: '#E8F5E8', accent: '#7CB342' },
    font: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  },
];

const AVAILABLE_FONTS = [
  { value: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", label: 'SF Pro Display (System)' },
  { value: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", label: 'Inter' },
  { value: "'Roboto', sans-serif", label: 'Roboto' },
  { value: "'Open Sans', sans-serif", label: 'Open Sans' },
  { value: "'Lato', sans-serif", label: 'Lato' },
  { value: "'Montserrat', sans-serif", label: 'Montserrat' },
  { value: "'Poppins', sans-serif", label: 'Poppins' },
  { value: "'Raleway', sans-serif", label: 'Raleway' },
  { value: "'Nunito', sans-serif", label: 'Nunito' },
  { value: "'Source Sans Pro', sans-serif", label: 'Source Sans Pro' },
];

function SettingsPanel({ currentTheme, onThemeChange }: SettingsPanelProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [googleKey, setGoogleKey] = useState('');
  const [showGoogleKey, setShowGoogleKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [selectedInlineModel, setSelectedInlineModel] = useState(MODELS[0].id);
  const [customPalettes, setCustomPalettes] = useState<CustomPalette[]>([]);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [newPalette, setNewPalette] = useState<CustomPalette>({
    name: '',
    background: '#272932',
    text: '#EAE0D5',
    accent: '#C6AC8F',
    font: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  });

  const [hasLoadedSettings, setHasLoadedSettings] = useState(false);
  const [hoverInlineModel, setHoverInlineModel] = useState(false);
  const [hoverAgentModel, setHoverAgentModel] = useState(false);

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
    
    // Same for inline model
    if (selectedInlineModel !== 'none' && !availableModelIds.includes(selectedInlineModel)) {
      setSelectedInlineModel('none');
      saveSettings('selectedInlineModel', 'none');
    }
  }, [anthropicKey, googleKey, hasLoadedSettings, selectedModel, selectedInlineModel]);

  const loadSettings = async () => {
    const savedFirstName = await window.faria.settings.get('firstName');
    const savedLastName = await window.faria.settings.get('lastName');
    const savedAnthropicKey = await window.faria.settings.get('anthropicKey');
    const savedGoogleKey = await window.faria.settings.get('googleKey');
    const savedModel = await window.faria.settings.get('selectedModel');
    const savedInlineModel = await window.faria.settings.get('selectedInlineModel');
    const savedCustomPalettes = await window.faria.settings.get('customPalettes');

    if (savedFirstName) setFirstName(savedFirstName);
    if (savedLastName) setLastName(savedLastName);
    if (savedAnthropicKey) setAnthropicKey(savedAnthropicKey);
    if (savedGoogleKey) setGoogleKey(savedGoogleKey);
    
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
    
    // Set models, but validate they're still available (or are "none")
    if (savedModel) {
      if (savedModel === 'none' || availableModelIds.includes(savedModel)) {
        setSelectedModel(savedModel);
      } else {
        // Model no longer available, default to "none"
        setSelectedModel('none');
        saveSettings('selectedModel', 'none');
      }
    }
    if (savedInlineModel) {
      if (savedInlineModel === 'none' || availableModelIds.includes(savedInlineModel)) {
        setSelectedInlineModel(savedInlineModel);
      } else {
        // Model no longer available, default to "none"
        setSelectedInlineModel('none');
        saveSettings('selectedInlineModel', 'none');
      }
    }
    if (savedCustomPalettes) {
      const parsed = JSON.parse(savedCustomPalettes);
      // Migrate old format (primary/secondary/accent) to new format (background/text/accent)
      const migrated = parsed.map((palette: any) => {
        if (palette.primary || palette.secondary) {
          return {
            name: palette.name,
            background: palette.primary || palette.background || '#272932',
            text: palette.secondary || palette.text || '#EAE0D5',
            accent: palette.accent || '#C6AC8F',
            font: palette.font || "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          };
        }
        // Ensure font exists
        return {
          ...palette,
          font: palette.font || "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
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
      } else {
        // Apply preset theme font
        const presetTheme = PRESET_THEMES.find(t => t.id === currentTheme);
        if (presetTheme?.font) {
          document.documentElement.style.setProperty('--font-family', presetTheme.font);
        }
      }
    }
  };

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
      font: currentValues.font,
    });
    setShowCustomForm(false);
    setShowThemeSelector(false);
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
    
    // Apply font
    if (theme.font) {
      document.documentElement.style.setProperty('--font-family', theme.font);
    }
    
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
    
    // Apply font
    if (palette.font) {
      document.documentElement.style.setProperty('--font-family', palette.font);
    }
    
    document.documentElement.setAttribute('data-theme', 'custom');
    
    // Save which custom palette is active
    await saveSettings('activeCustomPalette', palette.name);
    
    onThemeChange('custom');
  };

  const getCurrentThemeValues = (): { background: string; text: string; accent: string; font: string } => {
    if (currentTheme === 'custom') {
      // Get values from CSS variables
      const currentBg = document.documentElement.style.getPropertyValue('--color-primary')?.trim() || 
                       document.documentElement.style.getPropertyValue('--color-background')?.trim() ||
                       '#272932';
      const currentText = document.documentElement.style.getPropertyValue('--color-secondary')?.trim() ||
                         document.documentElement.style.getPropertyValue('--color-text')?.trim() ||
                         '#EAE0D5';
      const currentAccent = document.documentElement.style.getPropertyValue('--color-accent')?.trim() || '#C6AC8F';
      const currentFont = document.documentElement.style.getPropertyValue('--font-family')?.trim() ||
                         "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      
      return {
        background: currentBg,
        text: currentText,
        accent: currentAccent,
        font: currentFont
      };
    }
    
    // Get values from preset theme
    const preset = PRESET_THEMES.find(t => t.id === currentTheme);
    if (preset) {
      return {
        background: preset.colors.background,
        text: preset.colors.text,
        accent: preset.colors.accent,
        font: preset.font || "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
      };
    }
    
    // Fallback to default theme
    return {
      background: PRESET_THEMES[0].colors.background,
      text: PRESET_THEMES[0].colors.text,
      accent: PRESET_THEMES[0].colors.accent,
      font: PRESET_THEMES[0].font || "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    };
  };

  const getCurrentThemeInfo = () => {
    if (currentTheme === 'custom') {
      // Find the custom palette that matches current colors
      const currentBg = document.documentElement.style.getPropertyValue('--color-primary')?.trim();
      const currentText = document.documentElement.style.getPropertyValue('--color-secondary')?.trim();
      const currentAccent = document.documentElement.style.getPropertyValue('--color-accent')?.trim();
      const currentFont = document.documentElement.style.getPropertyValue('--font-family')?.trim();
      
      const matchingPalette = customPalettes.find(p => 
        p.background === currentBg && p.text === currentText && p.accent === currentAccent
      );
      
      if (matchingPalette) {
        return { name: matchingPalette.name, colors: matchingPalette, font: matchingPalette.font || currentFont, isCustom: true };
      }
      return { name: 'Custom', colors: { background: currentBg || '#272932', text: currentText || '#EAE0D5', accent: currentAccent || '#C6AC8F' }, font: currentFont, isCustom: true };
    }
    
    const preset = PRESET_THEMES.find(t => t.id === currentTheme);
    return preset 
      ? { name: preset.name, colors: preset.colors, font: preset.font, isCustom: false }
      : { name: 'Default', colors: PRESET_THEMES[0].colors, font: PRESET_THEMES[0].font, isCustom: false };
  };

  return (
    <div className="settings-panel">

      {/* Profile Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <h3 style={{ 
          fontSize: 'var(--font-size-md)', 
          marginBottom: 'var(--spacing-md)',
          color: 'var(--color-text-muted)'
        }}>
          Profile
        </h3>
        
        <div className="card">
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: 'var(--spacing-md)',
            padding: 'var(--spacing-md)'
          }}>
            <div>
              <label style={{ 
                display: 'block', 
                fontSize: 'var(--font-size-sm)', 
                marginBottom: 'var(--spacing-xs)',
                color: 'var(--color-text-muted)'
              }}>
                First Name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => {
                  setFirstName(e.target.value);
                  saveSettings('firstName', e.target.value);
                }}
                placeholder="Enter first name"
              />
            </div>
            <div>
              <label style={{ 
                display: 'block', 
                fontSize: 'var(--font-size-sm)', 
                marginBottom: 'var(--spacing-xs)',
                color: 'var(--color-text-muted)'
              }}>
                Last Name
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => {
                  setLastName(e.target.value);
                  saveSettings('lastName', e.target.value);
                }}
                placeholder="Enter last name"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Model Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <h3 style={{ 
          fontSize: 'var(--font-size-md)', 
          marginBottom: 'var(--spacing-md)',
          color: 'var(--color-text-muted)'
        }}>
          Models
        </h3>
        
        <div className="card">
          <div style={{ padding: 'var(--spacing-md)' }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr', 
              gap: 'var(--spacing-md)' 
            }}>
              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: 'var(--font-size-sm)', 
                  marginBottom: 'var(--spacing-xs)',
                  color: 'var(--color-text-muted)'
                }}>
                  Inline
                </label>
                <select
                  value={selectedInlineModel}
                  onChange={(e) => {
                    setSelectedInlineModel(e.target.value);
                    saveSettings('selectedInlineModel', e.target.value);
                  }}
                  onMouseEnter={() => setHoverInlineModel(true)}
                  onMouseLeave={() => setHoverInlineModel(false)}
                  style={{
                    width: '100%',
                    padding: 'var(--spacing-sm)',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${hoverInlineModel ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    backgroundColor: hoverInlineModel ? 'var(--color-hover)' : 'var(--color-primary)',
                    color: 'var(--color-text)',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
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
              
              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: 'var(--font-size-sm)', 
                  marginBottom: 'var(--spacing-xs)',
                  color: 'var(--color-text-muted)'
                }}>
                  Agent (beta)
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    saveSettings('selectedModel', e.target.value);
                  }}
                  onMouseEnter={() => setHoverAgentModel(true)}
                  onMouseLeave={() => setHoverAgentModel(false)}
                  style={{
                    width: '100%',
                    padding: 'var(--spacing-sm)',
                    fontSize: 'var(--font-size-sm)',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${hoverAgentModel ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    backgroundColor: hoverAgentModel ? 'var(--color-hover)' : 'var(--color-primary)',
                    color: 'var(--color-text)',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    MozAppearance: 'none',
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
            </div>
          </div>
        </div>
      </section>

      {/* API Keys Section */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <h3 style={{ 
          fontSize: 'var(--font-size-md)', 
          marginBottom: 'var(--spacing-md)',
          color: 'var(--color-text-muted)'
        }}>
          API Keys
        </h3>
        
        <div className="card">
          <div style={{ padding: 'var(--spacing-md)' }}>
            <div style={{ marginBottom: 'var(--spacing-md)' }}>
              <label style={{ 
                display: 'block', 
                fontSize: 'var(--font-size-sm)', 
                marginBottom: 'var(--spacing-xs)',
                color: 'var(--color-text-muted)'
              }}>
                Anthropic API Key
              </label>
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                <input
                  type={showAnthropicKey ? 'text' : 'password'}
                  value={anthropicKey}
                  onChange={(e) => {
                    setAnthropicKey(e.target.value);
                    saveSettings('anthropicKey', e.target.value);
                  }}
                  placeholder="sk-ant-..."
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                >
                  {showAnthropicKey ? 'Hide' : 'Show'}
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
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                <input
                  type={showGoogleKey ? 'text' : 'password'}
                  value={googleKey}
                  onChange={(e) => {
                    setGoogleKey(e.target.value);
                    saveSettings('googleKey', e.target.value);
                  }}
                  placeholder="AIxxxx..."
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowGoogleKey(!showGoogleKey)}
                >
                  {showGoogleKey ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Theme Section */}
      <section>
        <h3 style={{ 
          fontSize: 'var(--font-size-md)', 
          marginBottom: 'var(--spacing-md)',
          color: 'var(--color-text-muted)'
        }}>
          Theme
        </h3>
        
        {/* Current Theme Display */}
        <div className="card">
          <div style={{ 
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 'var(--spacing-md)'
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ 
                fontWeight: 600,
                fontSize: 'var(--font-size-lg)',
                marginBottom: 'var(--spacing-sm)'
              }}>
                {getCurrentThemeInfo().name}
              </div>
              <div style={{ 
                display: 'flex', 
                gap: 'var(--spacing-xs)',
                alignItems: 'center'
              }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-sm)',
                    background: getCurrentThemeInfo().colors.background,
                    border: '1px solid var(--color-border)'
                  }}
                  title="Background"
                />
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-sm)',
                    background: getCurrentThemeInfo().colors.text,
                    border: '1px solid var(--color-border)'
                  }}
                  title="Text"
                />
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 'var(--radius-sm)',
                    background: getCurrentThemeInfo().colors.accent,
                    border: '1px solid var(--color-border)'
                  }}
                  title="Accent"
                />
              </div>
            </div>
            <button
              className="btn btn-secondary"
              onClick={() => setShowThemeSelector(true)}
              style={{ marginLeft: 'var(--spacing-md)' }}
            >
              Edit
            </button>
          </div>
        </div>

        {/* Theme Selector Modal */}
        {showThemeSelector && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 'var(--spacing-lg)'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowThemeSelector(false);
              setShowCustomForm(false);
            }
          }}
          >
            <div style={{
              backgroundColor: 'var(--color-background)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              maxWidth: 900,
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: 'var(--shadow-lg)'
            }}
            onClick={(e) => e.stopPropagation()}
            >
              <div style={{
                padding: 'var(--spacing-lg)',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center'
              }}>
                <button
                  onClick={() => {
                    setShowThemeSelector(false);
                    setShowCustomForm(false);
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    fontSize: 'var(--font-size-xl)',
                    cursor: 'pointer',
                    padding: 'var(--spacing-xs)',
                    lineHeight: 1,
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'all var(--transition-fast)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-hover)';
                    e.currentTarget.style.color = 'var(--color-text)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--color-text-muted)';
                  }}
                  title="Close"
                >
                  ×
                </button>
              </div>
              
              <div style={{ padding: 'var(--spacing-lg)' }}>
                {!showCustomForm ? (
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', 
                    gap: 'var(--spacing-md)'
                  }}>
                    {/* Preset Themes */}
                    {PRESET_THEMES.map((theme) => (
                      <div
                        key={theme.id}
                        className="card"
                        onClick={async () => {
                          await applyPresetTheme(theme.id);
                          setShowThemeSelector(false);
                        }}
                        style={{ 
                          cursor: 'pointer',
                          border: currentTheme === theme.id 
                            ? '2px solid var(--color-accent)' 
                            : '1px solid var(--color-border)',
                          transition: 'border-color var(--transition-fast)'
                        }}
                      >
                        <div style={{ padding: 'var(--spacing-md)' }}>
                          <div style={{ 
                            fontWeight: 600, 
                            marginBottom: 'var(--spacing-sm)' 
                          }}>
                            {theme.name}
                          </div>
                          <div style={{ 
                            display: 'flex', 
                            gap: 'var(--spacing-xs)',
                            marginBottom: 'var(--spacing-xs)'
                          }}>
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 'var(--radius-sm)',
                                background: theme.colors.background,
                                border: '1px solid var(--color-border)'
                              }}
                              title="Background"
                            />
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 'var(--radius-sm)',
                                background: theme.colors.text,
                                border: '1px solid var(--color-border)'
                              }}
                              title="Text"
                            />
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 'var(--radius-sm)',
                                background: theme.colors.accent,
                                border: '1px solid var(--color-border)'
                              }}
                              title="Accent"
                            />
                          </div>
                          <div style={{
                            fontSize: 'var(--font-size-xs)',
                            color: 'var(--color-text-muted)',
                            fontFamily: theme.font
                          }}>
                            {AVAILABLE_FONTS.find(f => f.value === theme.font)?.label || 'System'}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Custom Palettes */}
                    {customPalettes.map((palette, index) => (
                      <div
                        key={index}
                        className="card"
                        onClick={async () => {
                          await applyCustomTheme(palette);
                          setShowThemeSelector(false);
                        }}
                        style={{ 
                          cursor: 'pointer',
                          border: currentTheme === 'custom' && 
                            document.documentElement.style.getPropertyValue('--color-primary')?.trim() === palette.background
                            ? '2px solid var(--color-accent)' 
                            : '1px solid var(--color-border)',
                          transition: 'border-color var(--transition-fast)',
                          position: 'relative'
                        }}
                      >
                        <div style={{ padding: 'var(--spacing-md)' }}>
                          <div style={{ 
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: 'var(--spacing-sm)'
                          }}>
                            <div style={{ 
                              fontWeight: 600
                            }}>
                              {palette.name}
                            </div>
                            <button
                              className="btn btn-secondary"
                              onClick={(e) => handleDeleteCustomPalette(index, e)}
                              style={{
                                padding: 'var(--spacing-xs) var(--spacing-sm)',
                                fontSize: 'var(--font-size-xs)',
                                minWidth: 'auto',
                                opacity: 0.7
                              }}
                              title="Delete theme"
                            >
                              ×
                            </button>
                          </div>
                          <div style={{ 
                            display: 'flex', 
                            gap: 'var(--spacing-xs)',
                            marginBottom: 'var(--spacing-xs)'
                          }}>
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 'var(--radius-sm)',
                                background: palette.background,
                                border: '1px solid var(--color-border)'
                              }}
                            />
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 'var(--radius-sm)',
                                background: palette.text,
                                border: '1px solid var(--color-border)'
                              }}
                            />
                            <div
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 'var(--radius-sm)',
                                background: palette.accent,
                                border: '1px solid var(--color-border)'
                              }}
                            />
                          </div>
                          {palette.font && (
                            <div style={{
                              fontSize: 'var(--font-size-xs)',
                              color: 'var(--color-text-muted)',
                              fontFamily: palette.font
                            }}>
                              {AVAILABLE_FONTS.find(f => f.value === palette.font)?.label || 'Custom'}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Add Custom Button */}
                    <div
                      className="card"
                      onClick={() => {
                        const currentValues = getCurrentThemeValues();
                        setNewPalette({
                          name: '',
                          background: currentValues.background,
                          text: currentValues.text,
                          accent: currentValues.accent,
                          font: currentValues.font,
                        });
                        setShowCustomForm(true);
                      }}
                      style={{ 
                        cursor: 'pointer',
                        border: '1px dashed var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: 80
                      }}
                    >
                      <span style={{ color: 'var(--color-text-muted)' }}>+ Add Custom</span>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ 
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 'var(--spacing-md)'
                    }}>
                      <h3 style={{ margin: 0 }}>New Custom Theme</h3>
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          const currentValues = getCurrentThemeValues();
                          setNewPalette({
                            name: '',
                            background: currentValues.background,
                            text: currentValues.text,
                            accent: currentValues.accent,
                            font: currentValues.font,
                          });
                          setShowCustomForm(false);
                        }}
                      >
                        Back
                      </button>
                    </div>
                    
                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                      <label style={{ 
                        display: 'block', 
                        fontSize: 'var(--font-size-sm)', 
                        marginBottom: 'var(--spacing-xs)',
                        color: 'var(--color-text-muted)'
                      }}>
                        Name
                      </label>
                      <input
                        type="text"
                        value={newPalette.name}
                        onChange={(e) => setNewPalette({ ...newPalette, name: e.target.value })}
                        placeholder="My Theme"
                      />
                    </div>

                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: '1fr 1fr 1fr', 
                      gap: 'var(--spacing-md)',
                      marginBottom: 'var(--spacing-md)'
                    }}>
                      <div>
                        <label style={{ 
                          display: 'block', 
                          fontSize: 'var(--font-size-sm)', 
                          marginBottom: 'var(--spacing-xs)',
                          color: 'var(--color-text-muted)'
                        }}>
                          Background
                        </label>
                        <input
                          type="color"
                          value={newPalette.background}
                          onChange={(e) => setNewPalette({ ...newPalette, background: e.target.value })}
                          style={{ width: '100%', height: 40, padding: 0, cursor: 'pointer' }}
                        />
                      </div>
                      <div>
                        <label style={{ 
                          display: 'block', 
                          fontSize: 'var(--font-size-sm)', 
                          marginBottom: 'var(--spacing-xs)',
                          color: 'var(--color-text-muted)'
                        }}>
                          Text
                        </label>
                        <input
                          type="color"
                          value={newPalette.text}
                          onChange={(e) => setNewPalette({ ...newPalette, text: e.target.value })}
                          style={{ width: '100%', height: 40, padding: 0, cursor: 'pointer' }}
                        />
                      </div>
                      <div>
                        <label style={{ 
                          display: 'block', 
                          fontSize: 'var(--font-size-sm)', 
                          marginBottom: 'var(--spacing-xs)',
                          color: 'var(--color-text-muted)'
                        }}>
                          Accent
                        </label>
                        <input
                          type="color"
                          value={newPalette.accent}
                          onChange={(e) => setNewPalette({ ...newPalette, accent: e.target.value })}
                          style={{ width: '100%', height: 40, padding: 0, cursor: 'pointer' }}
                        />
                      </div>
                    </div>

                    <div style={{ marginBottom: 'var(--spacing-md)' }}>
                      <label style={{ 
                        display: 'block', 
                        fontSize: 'var(--font-size-sm)', 
                        marginBottom: 'var(--spacing-xs)',
                        color: 'var(--color-text-muted)'
                      }}>
                        Font
                      </label>
                      <select
                        value={newPalette.font || AVAILABLE_FONTS[0].value}
                        onChange={(e) => setNewPalette({ ...newPalette, font: e.target.value })}
                        style={{
                          width: '100%',
                          padding: 'var(--spacing-sm)',
                          fontSize: 'var(--font-size-sm)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-primary)',
                          color: 'var(--color-text)',
                        }}
                      >
                        {AVAILABLE_FONTS.map((font) => (
                          <option key={font.value} value={font.value}>
                            {font.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary" onClick={() => {
                        const currentValues = getCurrentThemeValues();
                        setNewPalette({
                          name: '',
                          background: currentValues.background,
                          text: currentValues.text,
                          accent: currentValues.accent,
                          font: currentValues.font,
                        });
                        setShowCustomForm(false);
                      }}>
                        Cancel
                      </button>
                      <button className="btn" onClick={handleAddCustomPalette}>
                        Create Theme
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default SettingsPanel;

