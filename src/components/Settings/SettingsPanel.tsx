import React, { useState, useEffect } from 'react';

interface SettingsPanelProps {
  currentTheme: string;
  onThemeChange: (theme: string) => void;
}

interface CustomPalette {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
}


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
    colors: { primary: '#272932', secondary: '#EAE0D5', accent: '#C6AC8F' } 
  },
  { 
    id: 'midnight', 
    name: 'Midnight', 
    colors: { primary: '#0D1117', secondary: '#C9D1D9', accent: '#58A6FF' } 
  },
  { 
    id: 'forest', 
    name: 'Forest', 
    colors: { primary: '#1A2F1A', secondary: '#E8F5E8', accent: '#7CB342' } 
  },
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
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [newPalette, setNewPalette] = useState<CustomPalette>({
    name: '',
    primary: '#272932',
    secondary: '#EAE0D5',
    accent: '#C6AC8F',
  });

  useEffect(() => {
    loadSettings();
  }, []);

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
    if (savedModel) setSelectedModel(savedModel);
    if (savedInlineModel) setSelectedInlineModel(savedInlineModel);
    if (savedCustomPalettes) setCustomPalettes(JSON.parse(savedCustomPalettes));
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
    
    setNewPalette({
      name: '',
      primary: '#272932',
      secondary: '#EAE0D5',
      accent: '#C6AC8F',
    });
    setShowCustomForm(false);
  };

  const handleDeleteCustomPalette = async (index: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent applying the theme when clicking delete
    const updated = customPalettes.filter((_, i) => i !== index);
    setCustomPalettes(updated);
    await saveSettings('customPalettes', JSON.stringify(updated));
    setSaveStatus('Theme deleted');
    setTimeout(() => setSaveStatus(null), 1500);
  };

  const applyCustomTheme = (palette: CustomPalette) => {
    document.documentElement.style.setProperty('--color-primary', palette.primary);
    document.documentElement.style.setProperty('--color-secondary', palette.secondary);
    document.documentElement.style.setProperty('--color-accent', palette.accent);
    document.documentElement.setAttribute('data-theme', 'custom');
    onThemeChange('custom');
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
                  Agent Model
                </label>
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    saveSettings('selectedModel', e.target.value);
                  }}
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
                  {MODELS.map((model) => (
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
                  Inline Model
                </label>
                <select
                  value={selectedInlineModel}
                  onChange={(e) => {
                    setSelectedInlineModel(e.target.value);
                    saveSettings('selectedInlineModel', e.target.value);
                  }}
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
                  {MODELS.map((model) => (
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
              onClick={() => onThemeChange(theme.id)}
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
                  gap: 'var(--spacing-xs)' 
                }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 'var(--radius-sm)',
                      background: theme.colors.primary,
                      border: '1px solid var(--color-border)'
                    }}
                    title="Primary"
                  />
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 'var(--radius-sm)',
                      background: theme.colors.secondary,
                      border: '1px solid var(--color-border)'
                    }}
                    title="Secondary"
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
              </div>
            </div>
          ))}

          {/* Custom Palettes */}
          {customPalettes.map((palette, index) => (
            <div
              key={index}
              className="card"
              onClick={() => applyCustomTheme(palette)}
              style={{ 
                cursor: 'pointer',
                border: '1px solid var(--color-border)',
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
                  gap: 'var(--spacing-xs)' 
                }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 'var(--radius-sm)',
                      background: palette.primary,
                      border: '1px solid var(--color-border)'
                    }}
                  />
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 'var(--radius-sm)',
                      background: palette.secondary,
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
              </div>
            </div>
          ))}

          {/* Add Custom Button */}
          <div
            className="card"
            onClick={() => setShowCustomForm(true)}
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

        {/* Custom Palette Form */}
        {showCustomForm && (
          <div className="card" style={{ marginTop: 'var(--spacing-md)' }}>
            <div style={{ padding: 'var(--spacing-md)' }}>
              <h4 style={{ marginBottom: 'var(--spacing-md)' }}>New Custom Palette</h4>
              
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
                    Primary
                  </label>
                  <input
                    type="color"
                    value={newPalette.primary}
                    onChange={(e) => setNewPalette({ ...newPalette, primary: e.target.value })}
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
                    Secondary
                  </label>
                  <input
                    type="color"
                    value={newPalette.secondary}
                    onChange={(e) => setNewPalette({ ...newPalette, secondary: e.target.value })}
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

              <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setShowCustomForm(false)}>
                  Cancel
                </button>
                <button className="btn" onClick={handleAddCustomPalette}>
                  Add Palette
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default SettingsPanel;

