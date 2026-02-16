import React, { useState, useEffect, useRef } from 'react';
import FariaWordmark from '../FariaWordmark';

interface OnboardingProps {
  onComplete: () => void;
}

const FARIA_DESCRIPTION = `I'm Faria, your AI copilot for everything you do on your computer.

I can see your screen, type, click, scroll, and interact with your applications — just like you would, but faster.

Here's what I can help with:
• Draft and send emails, messages, and documents
• Navigate websites and fill out forms
• Write, edit, and debug code across any editor
• Automate repetitive workflows
• Search the web and summarize information
• Integrate with tools like Gmail, Slack, GitHub, and more

Just open the command bar from anywhere and tell me what you need.`;

function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [fade, setFade] = useState(true);
  const [typedText, setTypedText] = useState('');
  const [typingComplete, setTypingComplete] = useState(false);
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Animated step transition
  const goToStep = (newStep: number) => {
    setFade(false);
    setTimeout(() => {
      setStep(newStep);
      setFade(true);
    }, 200);
  };

  // Listen for command bar opened during onboarding
  useEffect(() => {
    if (step !== 0) return;

    const cleanup = window.faria.onboarding.onCommandBarOpened(() => {
      goToStep(1);
    });

    return cleanup;
  }, [step]);

  // Typewriter effect for step 1
  useEffect(() => {
    if (step !== 1) return;

    let charIndex = 0;
    setTypedText('');
    setTypingComplete(false);

    typingIntervalRef.current = setInterval(() => {
      if (charIndex < FARIA_DESCRIPTION.length) {
        setTypedText(FARIA_DESCRIPTION.slice(0, charIndex + 1));
        charIndex++;
      } else {
        if (typingIntervalRef.current) {
          clearInterval(typingIntervalRef.current);
          typingIntervalRef.current = null;
        }
        setTypingComplete(true);
      }
    }, 12);

    return () => {
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current);
        typingIntervalRef.current = null;
      }
    };
  }, [step]);

  const handleComplete = async () => {
    // Save default settings
    await window.faria.settings.set('onboardingCompleted', 'true');
    onComplete();
  };

  const skipTyping = () => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    setTypedText(FARIA_DESCRIPTION);
    setTypingComplete(true);
  };

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
    maxWidth: 600,
    padding: '40px 48px',
    opacity: fade ? 1 : 0,
    transform: fade ? 'translateY(0)' : 'translateY(8px)',
    transition: 'opacity 0.2s ease, transform 0.2s ease',
  };

  const headingStyle: React.CSSProperties = {
    fontSize: 32,
    fontWeight: 600,
    color: 'var(--color-text)',
    marginBottom: 12,
    letterSpacing: '-0.02em',
    textAlign: 'center',
  };

  const subheadingStyle: React.CSSProperties = {
    fontSize: 15,
    color: 'var(--color-text-muted)',
    marginBottom: 40,
    lineHeight: 1.6,
    textAlign: 'center',
  };

  const primaryButtonStyle: React.CSSProperties = {
    padding: '14px 40px',
    fontSize: 15,
    fontWeight: 500,
    background: 'var(--color-accent)',
    color: 'var(--color-background)',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: 'var(--font-family)',
  };

  const renderWelcome = () => (
    <div style={cardStyle}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
        marginBottom: 48,
      }}>
        <FariaWordmark height={64} />
      </div>

      <h2 style={headingStyle}>Welcome to Faria</h2>
      <p style={subheadingStyle}>
        Your AI copilot for work on a computer.
      </p>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
      }}>
        <p style={{
          fontSize: 16,
          color: 'var(--color-text)',
          fontWeight: 500,
          textAlign: 'center',
        }}>
          Open the command bar to get started
        </p>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 24px',
          background: 'var(--color-surface)',
          borderRadius: 10,
          border: '1px solid var(--color-border)',
        }}>
          <div style={{
            padding: '4px 10px',
            background: 'var(--color-background)',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            fontSize: 14,
            fontFamily: 'system-ui',
            color: 'var(--color-text)',
          }}>
            &#8984; Enter
          </div>
        </div>

        <div style={{
          marginTop: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <div style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--color-accent)',
            animation: 'pulse 2s infinite',
          }} />
          <span style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
          }}>
            Waiting for command bar...
          </span>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );

  const renderDemo = () => (
    <div style={{
      ...cardStyle,
      maxWidth: 680,
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        marginBottom: 24,
      }}>
        <FariaWordmark height={40} />
      </div>

      {/* Text area showing Faria's typed description */}
      <div
        onClick={!typingComplete ? skipTyping : undefined}
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 12,
          padding: '24px 28px',
          minHeight: 280,
          position: 'relative',
          cursor: !typingComplete ? 'pointer' : 'default',
        }}
      >
        <pre style={{
          fontSize: 14,
          lineHeight: 1.7,
          color: 'var(--color-text)',
          fontFamily: 'var(--font-family)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
        }}>
          {typedText}
          {!typingComplete && (
            <span style={{
              display: 'inline-block',
              width: 2,
              height: '1em',
              background: 'var(--color-accent)',
              marginLeft: 1,
              animation: 'blink 0.8s infinite',
              verticalAlign: 'text-bottom',
            }} />
          )}
        </pre>

        {!typingComplete && (
          <div style={{
            position: 'absolute',
            bottom: 12,
            right: 16,
            fontSize: 11,
            color: 'var(--color-text-muted)',
            opacity: 0.6,
          }}>
            Click to skip
          </div>
        )}
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginTop: 28,
        opacity: typingComplete ? 1 : 0.3,
        transition: 'opacity 0.3s ease',
      }}>
        <button
          style={{
            ...primaryButtonStyle,
            cursor: typingComplete ? 'pointer' : 'not-allowed',
          }}
          disabled={!typingComplete}
          onClick={handleComplete}
          onMouseEnter={e => { if (typingComplete) e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={e => { if (typingComplete) e.currentTarget.style.opacity = '1'; }}
        >
          Next
        </button>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
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
          WebkitAppRegion: 'no-drag',
        } as unknown as React.CSSProperties}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
      >
        Skip setup
      </button>

      {step === 0 && renderWelcome()}
      {step === 1 && renderDemo()}
    </div>
  );
}

export default Onboarding;
