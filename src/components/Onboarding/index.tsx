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
  const [isTyping, setIsTyping] = useState(false);
  const [typingComplete, setTypingComplete] = useState(false);
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Listen for query submission to start typing
  useEffect(() => {
    if (step !== 1 || isTyping || typingComplete) return;

    const cleanup = window.faria.onboarding.onQuerySubmitted(() => {
      startTyping();
    });

    return cleanup;
  }, [step, isTyping, typingComplete]);

  const startTyping = () => {
    let charIndex = 0;
    setTypedText('');
    setIsTyping(true);
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
        setIsTyping(false);
        setTypingComplete(true);
      }
    }, 12);
  };

  // Cleanup typing interval on unmount
  useEffect(() => {
    return () => {
      if (typingIntervalRef.current) {
        clearInterval(typingIntervalRef.current);
        typingIntervalRef.current = null;
      }
    };
  }, []);

  const handleComplete = async () => {
    // Save default settings
    await window.faria.settings.set('onboardingCompleted', 'true');
    onComplete();
  };

  // Allow Enter to advance when typing is complete
  useEffect(() => {
    if (!typingComplete) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleComplete();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [typingComplete]);

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

  const primaryButtonStyle: React.CSSProperties = {
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 500,
    background: 'var(--color-accent)',
    color: 'var(--color-background)',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    fontFamily: 'var(--font-family)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
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
          <span style={{
            display: 'inline-block',
            padding: '2px 10px',
            background: 'var(--color-surface)',
            borderRadius: 6,
            border: '1px solid var(--color-border)',
            fontWeight: 600,
            margin: '0 4px',
            fontFamily: 'system-ui',
            fontSize: 15
          }}>
            &#8984; + return
          </span> to get started
        </p>


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
      <div style={{ position: 'relative' }}>
        <textarea
          ref={textareaRef}
          value={typedText}
          onChange={e => { if (typingComplete) setTypedText(e.target.value); }}
          readOnly={!typingComplete}
          style={{
            width: '100%',
            height: 380,
            fontSize: 14,
            lineHeight: 1.7,
            color: 'var(--color-text)',
            background: 'transparent',
            fontFamily: 'var(--font-family)',
            border: 'none',
            outline: 'none',
            resize: 'none',
            overflow: 'hidden',
            caretColor: typingComplete ? 'var(--color-text)' : 'transparent',
          }}
        />
        {!isTyping && !typingComplete && (
          <span style={{
            position: 'absolute',
            top: 0,
            left: 0,
            display: 'inline-block',
            width: 2,
            height: '1em',
            background: 'var(--color-text)',
            animation: 'blink 0.8s infinite',
            pointerEvents: 'none',
          }} />
        )}
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: 16,
        height: 24,
        opacity: typingComplete ? 1 : 0,
        transition: 'opacity 0.4s ease',
      }}>
        <button
          style={primaryButtonStyle}
          onClick={handleComplete}
          disabled={!typingComplete}
          onMouseEnter={e => { if (typingComplete) e.currentTarget.style.opacity = '0.9'; }}
          onMouseLeave={e => { if (typingComplete) e.currentTarget.style.opacity = '1'; }}
        >
          Next
          <span style={{ fontSize: 11, lineHeight: 1 }}>&#9166;</span>
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

      {step === 0 && renderWelcome()}
      {step === 1 && renderDemo()}
    </div>
  );
}

export default Onboarding;
