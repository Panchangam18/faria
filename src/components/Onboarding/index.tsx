import React, { useState, useEffect } from 'react';
import FariaLogo from '../FariaLogo';

interface OnboardingProps {
  onComplete: () => void;
}

const MODELS = [
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4.5', provider: 'anthropic' },
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

const TOOLS = [
  { key: 'screenshot', name: 'Screenshots', description: 'Capture screen images' },
  { key: 'typing', name: 'Typing', description: 'Type text and press keys' },
  { key: 'replaceText', name: 'Replace Text', description: 'Replace selected text in apps' },
  { key: 'insertImage', name: 'Insert Image', description: 'Search and insert images' },
  { key: 'clicking', name: 'Clicking', description: 'Click, double-click, and right-click' },
  { key: 'scrolling', name: 'Scrolling & Dragging', description: 'Scroll and drag the mouse' },
  { key: 'integrations', name: 'External Integrations', description: 'Gmail, Slack, GitHub, etc.' },
];

type ToolSetting = 'enabled' | 'disabled' | 'auto-approve';

const TOTAL_STEPS = 5;

// Derive accent colors from a base accent hex
const deriveAccentColors = (accent: string): { hover: string; active: string } => {
  const hex = accent.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const hoverFactor = brightness > 128 ? 0.85 : 1.15;
  const activeFactor = brightness > 128 ? 0.75 : 1.25;
  const clamp = (n: number) => Math.min(255, Math.max(0, Math.round(n)));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return {
    hover: `#${toHex(clamp(r * hoverFactor))}${toHex(clamp(g * hoverFactor))}${toHex(clamp(b * hoverFactor))}`,
    active: `#${toHex(clamp(r * activeFactor))}${toHex(clamp(g * activeFactor))}${toHex(clamp(b * activeFactor))}`,
  };
};

const applyThemeColors = (colors: { background: string; text: string; accent: string }, themeId: string) => {
  const accentColors = deriveAccentColors(colors.accent);
  const bgHex = colors.background.replace('#', '');
  const bgR = parseInt(bgHex.substring(0, 2), 16);
  const bgG = parseInt(bgHex.substring(2, 4), 16);
  const bgB = parseInt(bgHex.substring(4, 6), 16);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  const lightR = Math.min(255, Math.round(bgR * 1.2));
  const lightG = Math.min(255, Math.round(bgG * 1.2));
  const lightB = Math.min(255, Math.round(bgB * 1.2));
  const darkR = Math.max(0, Math.round(bgR * 0.7));
  const darkG = Math.max(0, Math.round(bgG * 0.7));
  const darkB = Math.max(0, Math.round(bgB * 0.7));

  const root = document.documentElement;
  root.style.setProperty('--color-primary', colors.background);
  root.style.setProperty('--color-secondary', colors.text);
  root.style.setProperty('--color-accent', colors.accent);
  root.style.setProperty('--color-primary-light', `#${toHex(lightR)}${toHex(lightG)}${toHex(lightB)}`);
  root.style.setProperty('--color-primary-dark', `#${toHex(darkR)}${toHex(darkG)}${toHex(darkB)}`);
  root.style.setProperty('--color-secondary-muted', colors.text + 'B3');
  root.style.setProperty('--color-accent-hover', accentColors.hover);
  root.style.setProperty('--color-accent-active', accentColors.active);
  root.style.setProperty('--color-background', colors.background);
  root.style.setProperty('--color-surface', `#${toHex(lightR)}${toHex(lightG)}${toHex(lightB)}`);
  root.style.setProperty('--color-text', colors.text);
  root.style.setProperty('--color-text-muted', colors.text + 'B3');
  root.style.setProperty('--color-border', colors.text + '26');
  root.style.setProperty('--color-hover', colors.text + '14');
  root.setAttribute('data-theme', themeId);
};

function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [fade, setFade] = useState(true);

  // Step 1: API Keys
  const [anthropicKey, setAnthropicKey] = useState('');
  const [googleKey, setGoogleKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('none');
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showGoogleKey, setShowGoogleKey] = useState(false);

  // Step 2: Permissions
  const [accessibilityGranted, setAccessibilityGranted] = useState(false);
  const [screenRecordingStatus, setScreenRecordingStatus] = useState('not-determined');
  const [toolSettings, setToolSettings] = useState<Record<string, ToolSetting>>({
    screenshot: 'enabled',
    typing: 'enabled',
    replaceText: 'enabled',
    insertImage: 'enabled',
    clicking: 'enabled',
    scrolling: 'enabled',
    integrations: 'enabled',
  });

  // Step 3: Theme
  const [selectedTheme, setSelectedTheme] = useState('default');
  const [hoveredTheme, setHoveredTheme] = useState<string | null>(null);

  // Animated step transition
  const goToStep = (newStep: number) => {
    setFade(false);
    setTimeout(() => {
      setStep(newStep);
      setFade(true);
    }, 200);
  };

  // Poll permissions when on the permissions step
  useEffect(() => {
    if (step !== 2) return;

    const checkPermissions = async () => {
      try {
        const accessible = await window.faria.onboarding.checkAccessibility();
        setAccessibilityGranted(accessible);
        const screenStatus = await window.faria.onboarding.checkScreenRecording();
        setScreenRecordingStatus(screenStatus);
      } catch (e) {
        console.error('Failed to check permissions:', e);
      }
    };

    checkPermissions();
    const interval = setInterval(checkPermissions, 2000);
    return () => clearInterval(interval);
  }, [step]);

  // Auto-select first available model when keys change
  useEffect(() => {
    const available = getAvailableModels();
    if (available.length > 0 && (selectedModel === 'none' || !available.find(m => m.id === selectedModel))) {
      setSelectedModel(available[0].id);
    } else if (available.length === 0) {
      setSelectedModel('none');
    }
  }, [anthropicKey, googleKey]);

  const getAvailableModels = () => {
    return MODELS.filter(model => {
      if (model.provider === 'anthropic' && anthropicKey.trim()) return true;
      if (model.provider === 'google' && googleKey.trim()) return true;
      return false;
    });
  };

  const saveAllSettings = async () => {
    if (anthropicKey.trim()) await window.faria.settings.set('anthropicKey', anthropicKey);
    if (googleKey.trim()) await window.faria.settings.set('googleKey', googleKey);
    if (selectedModel !== 'none') await window.faria.settings.set('selectedModel', selectedModel);
    await window.faria.settings.set('toolSettings', JSON.stringify(toolSettings));
    await window.faria.settings.set('theme', selectedTheme);
    await window.faria.settings.set('onboardingCompleted', 'true');
  };

  const handleComplete = async () => {
    await saveAllSettings();
    onComplete();
  };

  const hasApiKey = !!(anthropicKey.trim() || googleKey.trim());

  // Shared styles
  const containerStyle: React.CSSProperties = {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-background)',
    position: 'relative',
    overflow: 'hidden',
  };

  const cardStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 560,
    padding: '40px 48px',
    opacity: fade ? 1 : 0,
    transform: fade ? 'translateY(0)' : 'translateY(8px)',
    transition: 'opacity 0.2s ease, transform 0.2s ease',
  };

  const headingStyle: React.CSSProperties = {
    fontSize: 28,
    fontWeight: 600,
    color: 'var(--color-text)',
    marginBottom: 8,
    letterSpacing: '-0.02em',
  };

  const subheadingStyle: React.CSSProperties = {
    fontSize: 14,
    color: 'var(--color-text-muted)',
    marginBottom: 32,
    lineHeight: 1.6,
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 11,
    color: 'var(--color-text-muted)',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: 500,
  };

  const inputWrapperStyle: React.CSSProperties = {
    position: 'relative',
    marginBottom: 16,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 40px 10px 14px',
    fontSize: 13,
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family)',
    transition: 'border-color 0.15s ease',
  };

  const eyeButtonStyle: React.CSSProperties = {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    padding: 4,
    cursor: 'pointer',
    color: 'var(--color-text-muted)',
    display: 'flex',
    alignItems: 'center',
  };

  const primaryButtonStyle: React.CSSProperties = {
    padding: '12px 32px',
    fontSize: 14,
    fontWeight: 500,
    background: 'var(--color-accent)',
    color: 'var(--color-background)',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: 'var(--font-family)',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    padding: '12px 24px',
    fontSize: 14,
    fontWeight: 500,
    background: 'transparent',
    color: 'var(--color-text-muted)',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'color 0.15s ease',
    fontFamily: 'var(--font-family)',
  };

  const footerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 32,
  };

  // Step dots
  const renderStepDots = () => (
    <div style={{
      display: 'flex',
      gap: 8,
      justifyContent: 'center',
      marginBottom: 40,
    }}>
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          style={{
            width: i === step ? 24 : 8,
            height: 8,
            borderRadius: 4,
            background: i === step ? 'var(--color-accent)' : i < step ? 'var(--color-accent)' : 'var(--color-border)',
            opacity: i < step ? 0.5 : 1,
            transition: 'all 0.3s ease',
          }}
        />
      ))}
    </div>
  );

  // Eye icon for password toggle
  const EyeIcon = ({ visible }: { visible: boolean }) => (
    visible ? (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    ) : (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  );

  // Status indicator
  const StatusDot = ({ granted }: { granted: boolean }) => (
    <div style={{
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: granted ? '#4caf50' : '#ff9800',
      flexShrink: 0,
    }} />
  );

  // ---- STEP RENDERS ----

  const renderWelcome = () => (
    <div style={cardStyle}>
      <div style={{ textAlign: 'center' }}>
        <FariaLogo size={80} style={{ marginBottom: 12 }} />
        <div style={{
          fontSize: 48,
          fontWeight: 700,
          color: 'var(--color-accent)',
          marginBottom: 4,
          letterSpacing: '-0.03em',
        }}>
          Faria
        </div>
        <div style={{
          fontSize: 15,
          color: 'var(--color-text-muted)',
          marginBottom: 40,
          fontStyle: 'italic',
        }}>
          Your AI copilot for computer automation
        </div>

        <div style={{
          fontSize: 14,
          color: 'var(--color-text)',
          lineHeight: 1.8,
          marginBottom: 48,
          maxWidth: 420,
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          Faria helps you accomplish tasks across any Mac application using natural language.
          Describe what you want to do, and Faria takes care of it — typing, clicking,
          reading screens, and automating workflows.
        </div>

        <button
          style={primaryButtonStyle}
          onClick={() => goToStep(1)}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          Get Started
        </button>

        <div style={{
          marginTop: 16,
          fontSize: 12,
          color: 'var(--color-text-muted)',
          opacity: 0.6,
        }}>
          Takes about a minute to set up
        </div>
      </div>
    </div>
  );

  const renderApiKeys = () => (
    <div style={cardStyle}>
      {renderStepDots()}
      <h2 style={headingStyle}>Connect to AI</h2>
      <p style={subheadingStyle}>
        Faria uses AI models to understand and execute your requests.
        Add at least one API key to get started.
      </p>

      {/* Anthropic Key */}
      <div>
        <label style={labelStyle}>Anthropic API Key</label>
        <div style={inputWrapperStyle}>
          <input
            type={showAnthropicKey ? 'text' : 'password'}
            value={anthropicKey}
            onChange={e => setAnthropicKey(e.target.value)}
            placeholder="sk-ant-..."
            style={inputStyle}
          />
          <button
            style={eyeButtonStyle}
            onClick={() => setShowAnthropicKey(!showAnthropicKey)}
          >
            <EyeIcon visible={showAnthropicKey} />
          </button>
        </div>
      </div>

      {/* Google Key */}
      <div>
        <label style={labelStyle}>Google AI API Key</label>
        <div style={inputWrapperStyle}>
          <input
            type={showGoogleKey ? 'text' : 'password'}
            value={googleKey}
            onChange={e => setGoogleKey(e.target.value)}
            placeholder="AIxxxx..."
            style={inputStyle}
          />
          <button
            style={eyeButtonStyle}
            onClick={() => setShowGoogleKey(!showGoogleKey)}
          >
            <EyeIcon visible={showGoogleKey} />
          </button>
        </div>
      </div>

      {/* Model Selection */}
      {hasApiKey && (
        <div style={{ marginTop: 8 }}>
          <label style={labelStyle}>Model</label>
          <select
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              fontSize: 13,
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)',
              cursor: 'pointer',
              fontFamily: 'var(--font-family)',
            }}
          >
            {getAvailableModels().map(model => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
        </div>
      )}

      <div style={footerStyle}>
        <button style={secondaryButtonStyle} onClick={() => goToStep(0)}>
          Back
        </button>
        <button
          style={{
            ...primaryButtonStyle,
            opacity: hasApiKey ? 1 : 0.4,
            cursor: hasApiKey ? 'pointer' : 'not-allowed',
          }}
          disabled={!hasApiKey}
          onClick={() => goToStep(2)}
          onMouseEnter={e => { if (hasApiKey) e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={e => { if (hasApiKey) e.currentTarget.style.opacity = '1'; }}
        >
          Next
        </button>
      </div>
    </div>
  );

  const renderPermissions = () => (
    <div style={cardStyle}>
      {renderStepDots()}
      <h2 style={headingStyle}>Enable Computer Control</h2>
      <p style={subheadingStyle}>
        Faria needs system permissions to interact with your applications. Grant access
        so it can read screen content, type, click, and automate tasks.
      </p>

      {/* Accessibility Permission */}
      <div style={{
        padding: '16px 20px',
        background: 'var(--color-surface)',
        borderRadius: 10,
        border: '1px solid var(--color-border)',
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot granted={accessibilityGranted} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>
                Accessibility
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Required to read UI elements, click, and type
              </div>
            </div>
          </div>
          {!accessibilityGranted && (
            <button
              onClick={async () => {
                await window.faria.onboarding.requestAccessibility();
                await window.faria.onboarding.openAccessibilitySettings();
              }}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 500,
                background: 'var(--color-accent)',
                color: 'var(--color-background)',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: 'var(--font-family)',
              }}
            >
              Enable
            </button>
          )}
          {accessibilityGranted && (
            <span style={{ fontSize: 12, color: '#4caf50', fontWeight: 500 }}>Granted</span>
          )}
        </div>
      </div>

      {/* Screen Recording Permission */}
      <div style={{
        padding: '16px 20px',
        background: 'var(--color-surface)',
        borderRadius: 10,
        border: '1px solid var(--color-border)',
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot granted={screenRecordingStatus === 'granted'} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text)' }}>
                Screen Recording
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Required to capture screenshots for context
              </div>
            </div>
          </div>
          {screenRecordingStatus !== 'granted' && (
            <button
              onClick={() => window.faria.onboarding.openScreenRecordingSettings()}
              style={{
                padding: '6px 14px',
                fontSize: 12,
                fontWeight: 500,
                background: 'var(--color-accent)',
                color: 'var(--color-background)',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: 'var(--font-family)',
              }}
            >
              Enable
            </button>
          )}
          {screenRecordingStatus === 'granted' && (
            <span style={{ fontSize: 12, color: '#4caf50', fontWeight: 500 }}>Granted</span>
          )}
        </div>
      </div>

      {/* Action Permissions */}
      <div style={{ marginBottom: 8 }}>
        <label style={labelStyle}>Action Permissions</label>
      </div>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}>
        {TOOLS.map(tool => (
          <div
            key={tool.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 0',
            }}
          >
            <div>
              <span style={{ fontSize: 13, color: 'var(--color-text)' }}>{tool.name}</span>
              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 8 }}>
                {tool.description}
              </span>
            </div>
            <select
              value={toolSettings[tool.key] || 'enabled'}
              onChange={e => setToolSettings(prev => ({
                ...prev,
                [tool.key]: e.target.value as ToolSetting,
              }))}
              style={{
                padding: '3px 6px',
                fontSize: 12,
                borderRadius: 4,
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-surface)',
                color: 'var(--color-text)',
                cursor: 'pointer',
                fontFamily: 'var(--font-family)',
                minWidth: 90,
              }}
            >
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
              <option value="auto-approve">Auto-approve</option>
            </select>
          </div>
        ))}
      </div>

      <div style={footerStyle}>
        <button style={secondaryButtonStyle} onClick={() => goToStep(1)}>
          Back
        </button>
        <button
          style={primaryButtonStyle}
          onClick={() => goToStep(3)}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          Next
        </button>
      </div>
    </div>
  );

  const renderTheme = () => (
    <div style={cardStyle}>
      {renderStepDots()}
      <h2 style={headingStyle}>Choose Your Look</h2>
      <p style={subheadingStyle}>
        Pick a theme for Faria. You can always change this later in Settings.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 12,
      }}>
        {PRESET_THEMES.map(theme => {
          const isSelected = selectedTheme === theme.id;
          const isHovered = hoveredTheme === theme.id;

          return (
            <div
              key={theme.id}
              onClick={() => {
                setSelectedTheme(theme.id);
                applyThemeColors(theme.colors, theme.id);
              }}
              onMouseEnter={() => setHoveredTheme(theme.id)}
              onMouseLeave={() => setHoveredTheme(null)}
              style={{
                cursor: 'pointer',
                borderRadius: 10,
                overflow: 'hidden',
                background: theme.colors.background,
                border: isSelected
                  ? `2px solid ${theme.colors.accent}`
                  : '2px solid transparent',
                padding: 16,
                transition: 'all 0.2s ease',
                transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
                boxShadow: isHovered ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
              }}
            >
              {/* Mini command bar preview */}
              <div style={{
                background: theme.colors.background,
                border: `1px solid ${theme.colors.text}20`,
                borderRadius: 6,
                padding: '8px 12px',
                marginBottom: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{
                  fontSize: 11,
                  color: theme.colors.text,
                  opacity: 0.5,
                }}>
                  Ask Faria anything...
                </span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill={theme.colors.accent}>
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </div>

              {/* Theme info */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: theme.colors.text,
                }}>
                  {theme.name}
                </span>
                {/* Color swatches */}
                <div style={{ display: 'flex', gap: 4 }}>
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: theme.colors.text,
                    border: `1px solid ${theme.colors.text}40`,
                  }} />
                  <div style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: theme.colors.accent,
                    border: `1px solid ${theme.colors.accent}40`,
                  }} />
                </div>
              </div>

              {/* Selected indicator */}
              {isSelected && (
                <div style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: theme.colors.accent,
                  fontWeight: 500,
                  textAlign: 'center',
                }}>
                  Selected
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={footerStyle}>
        <button style={secondaryButtonStyle} onClick={() => goToStep(2)}>
          Back
        </button>
        <button
          style={primaryButtonStyle}
          onClick={() => goToStep(4)}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          Next
        </button>
      </div>
    </div>
  );

  const renderReady = () => (
    <div style={cardStyle}>
      {renderStepDots()}
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ ...headingStyle, textAlign: 'center' }}>You're All Set</h2>
        <p style={{ ...subheadingStyle, textAlign: 'center' }}>
          Here are the shortcuts to control Faria. You can customize these in Settings.
        </p>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        marginBottom: 8,
      }}>
        {[
          { keys: '\u2318 Enter', label: 'Open command bar', description: 'Summon Faria from anywhere' },
          { keys: '\u2318 \u21E7 Enter', label: 'Reset command bar', description: 'Reset position and clear state' },
          { keys: '\u2318 \u2325 Arrows', label: 'Move command bar', description: 'Reposition on screen' },
          { keys: '\u2318 \u2303 \u2191\u2193', label: 'Adjust transparency', description: 'Change command bar opacity' },
        ].map((shortcut, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '12px 16px',
              background: 'var(--color-surface)',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
            }}
          >
            <div style={{
              padding: '4px 10px',
              background: 'var(--color-background)',
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              fontSize: 13,
              fontFamily: 'system-ui',
              color: 'var(--color-text)',
              whiteSpace: 'nowrap',
              minWidth: 100,
              textAlign: 'center',
            }}>
              {shortcut.keys}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
                {shortcut.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 1 }}>
                {shortcut.description}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...footerStyle, justifyContent: 'center', marginTop: 36 }}>
        <button
          style={{
            ...primaryButtonStyle,
            padding: '14px 48px',
            fontSize: 15,
          }}
          onClick={handleComplete}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          Start Using Faria
        </button>
      </div>
    </div>
  );

  return (
    <div style={containerStyle}>
      {/* Draggable title bar area */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 40,
        WebkitAppRegion: 'drag',
        zIndex: 10,
      } as unknown as React.CSSProperties} />

      {/* Skip button */}
      {step > 0 && step < TOTAL_STEPS - 1 && (
        <button
          onClick={handleComplete}
          style={{
            position: 'absolute',
            top: 14,
            right: 20,
            fontSize: 12,
            color: 'var(--color-text-muted)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            zIndex: 20,
            padding: '4px 8px',
            fontFamily: 'var(--font-family)',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
        >
          Skip setup
        </button>
      )}

      {step === 0 && renderWelcome()}
      {step === 1 && renderApiKeys()}
      {step === 2 && renderPermissions()}
      {step === 3 && renderTheme()}
      {step === 4 && renderReady()}
    </div>
  );
}

export default Onboarding;
