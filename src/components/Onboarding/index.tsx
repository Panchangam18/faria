import React, { useState, useEffect, useRef, useCallback } from 'react';
import FariaLogo from '../FariaLogo';

interface OnboardingProps {
  onComplete: () => void;
}

interface PermissionStatus {
  accessibility: boolean;
  screenRecording: boolean;
}

function Onboarding({ onComplete }: OnboardingProps) {
  const [permissions, setPermissions] = useState<PermissionStatus>({ accessibility: false, screenRecording: false });
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iconFlameRef = useRef<SVGPathElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const checkPermissions = useCallback(async () => {
    const result = await window.faria.permissions.check();
    setPermissions(result);
    setLoading(false);
    return result;
  }, []);

  useEffect(() => {
    checkPermissions();
    // Poll every 2s so the UI updates after the user grants permissions in System Settings
    pollRef.current = setInterval(checkPermissions, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [checkPermissions]);

  const allGranted = permissions.accessibility && permissions.screenRecording;

  const handleLogoClick = useCallback(() => {
    const flame = iconFlameRef.current;
    const svg = flame?.closest('svg');
    if (svg) {
      svg.classList.remove('flame-breathing');
      void svg.getBBox();
      svg.classList.add('flame-breathing');
    }
    const container = containerRef.current;
    if (container) {
      container.classList.remove('splotch-breathing');
      void container.offsetWidth;
      container.classList.add('splotch-breathing');
    }
  }, []);

  const handleRequestAccessibility = async () => {
    await window.faria.permissions.requestAccessibility();
  };

  const handleRequestScreenRecording = async () => {
    await window.faria.permissions.requestScreenRecording();
  };

  if (loading) return null;

  const containerStyle: React.CSSProperties = {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-background)',
    position: 'relative',
    overflow: 'hidden',
  };

  const cardStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 28,
    maxWidth: 360,
    width: '100%',
  };

  const titleStyle: React.CSSProperties = {
    fontFamily: "'Bricolage Grotesque', var(--font-family)",
    fontSize: 20,
    fontWeight: 600,
    color: 'var(--color-text)',
    textAlign: 'center',
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: 13,
    color: 'var(--color-text-muted)',
    textAlign: 'center',
    lineHeight: 1.5,
    maxWidth: 300,
  };

  const permissionRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: 320,
    padding: '14px 16px',
    borderRadius: 10,
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    transition: 'all 0.15s ease',
  };

  const labelAreaStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 14,
    fontWeight: 500,
    color: 'var(--color-text)',
    fontFamily: 'var(--font-family)',
  };

  const descStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-family)',
  };

  const enableBtnStyle: React.CSSProperties = {
    padding: '6px 14px',
    borderRadius: 6,
    border: 'none',
    background: 'var(--color-accent)',
    color: 'var(--color-background)',
    fontSize: 12,
    fontWeight: 600,
    fontFamily: 'var(--font-family)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    flexShrink: 0,
  };

  const grantedStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--color-accent)',
    fontFamily: 'var(--font-family)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  };

  const continueBtnStyle: React.CSSProperties = {
    width: 320,
    height: 42,
    borderRadius: 8,
    border: 'none',
    background: allGranted ? 'var(--color-accent)' : 'var(--color-surface)',
    color: allGranted ? 'var(--color-background)' : 'var(--color-text-muted)',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'var(--font-family)',
    cursor: allGranted ? 'pointer' : 'default',
    opacity: allGranted ? 1 : 0.5,
    transition: 'all 0.25s ease',
    marginTop: 4,
  };

  return (
    <div ref={containerRef} style={containerStyle}>
      <div className="accent-splotch-container">
        <div className="accent-splotch accent-splotch-1" />
        <div className="accent-splotch accent-splotch-2" />
        <div className="accent-splotch accent-splotch-3" />
        <div className="accent-splotch accent-splotch-4" />
        <div className="accent-splotch accent-splotch-5" />
        <div className="accent-splotch accent-splotch-6" />
      </div>

      {/* Draggable title bar area */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 40,
        WebkitAppRegion: 'drag',
      } as unknown as React.CSSProperties} />

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div onClick={handleLogoClick} style={{ cursor: 'pointer', display: 'flex', flexShrink: 0, marginLeft: -16 }}>
            <FariaLogo size={56} noFilter flameRef={iconFlameRef} />
          </div>
          <span onClick={handleLogoClick} style={{
            fontFamily: "'Bricolage Grotesque', var(--font-family)",
            fontSize: 66,
            fontWeight: 400,
            color: 'var(--color-text)',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
          }}>Faria</span>
        </div>


        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Accessibility */}
          <div style={permissionRowStyle}>
            <div style={labelAreaStyle}>
              <span style={labelStyle}>Accessibility</span>
              <span style={descStyle}>Automate clicks and keyboard input</span>
            </div>
            {permissions.accessibility ? (
              <span style={grantedStyle}>
                <CheckIcon />
                Enabled
              </span>
            ) : (
              <button
                style={enableBtnStyle}
                onClick={handleRequestAccessibility}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >
                Enable
              </button>
            )}
          </div>

          {/* Screen Recording */}
          <div style={permissionRowStyle}>
            <div style={labelAreaStyle}>
              <span style={labelStyle}>Screen Recording</span>
              <span style={descStyle}>Capture screenshots for visual context</span>
            </div>
            {permissions.screenRecording ? (
              <span style={grantedStyle}>
                <CheckIcon />
                Enabled
              </span>
            ) : (
              <button
                style={enableBtnStyle}
                onClick={handleRequestScreenRecording}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
              >
                Enable
              </button>
            )}
          </div>
        </div>

        <button
          style={continueBtnStyle}
          onClick={allGranted ? onComplete : undefined}
          onMouseEnter={e => { if (allGranted) e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={e => { if (allGranted) e.currentTarget.style.opacity = '1'; }}
        >
          Continue
        </button>

        {!allGranted && (
          <button
            onClick={onComplete}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted)',
              fontSize: 12,
              fontFamily: 'var(--font-family)',
              cursor: 'pointer',
              padding: 0,
              opacity: 0.7,
              transition: 'opacity 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '0.7'; }}
          >
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export default Onboarding;
