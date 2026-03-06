import React, { useState, useRef, useEffect, useCallback } from 'react';
import { auth } from '../../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import FariaWordmark from '../FariaWordmark';

interface SignInProps {
  onSignIn: () => void;
}

function SignIn({ onSignIn }: SignInProps) {
  const [mode, setMode] = useState<'buttons' | 'email'>('buttons');
  const [emailMode, setEmailMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await window.faria.auth.googleSignIn();
      if (result.success && result.email && result.uid) {
        onSignIn();
      } else {
        setError(result.error || 'Google sign-in failed.');
      }
    } catch {
      setError('Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGuestSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const userCredential = await signInAnonymously(auth);
      const user = userCredential.user;
      await window.faria.settings.set('userEmail', 'guest');
      await window.faria.settings.set('userUid', user.uid);
      await window.faria.settings.set('authProvider', 'anonymous');
      onSignIn();
    } catch {
      setError('Guest sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      let userCredential;
      if (emailMode === 'signup') {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
      } else {
        userCredential = await signInWithEmailAndPassword(auth, email, password);
      }
      const user = userCredential.user;
      const userEmail = user.email || email;
      const userUid = user.uid;
      await window.faria.settings.set('userEmail', userEmail);
      await window.faria.settings.set('userUid', userUid);
      await window.faria.settings.set('authProvider', 'email');
      onSignIn();
    } catch (err: unknown) {
      const firebaseError = err as { code?: string; message?: string };
      const code = firebaseError.code;
      if (code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
        setError('No account found with that email. Try signing up.');
      } else if (code === 'auth/wrong-password') {
        setError('Incorrect password.');
      } else if (code === 'auth/email-already-in-use') {
        setError('Email already registered. Try signing in.');
      } else if (code === 'auth/weak-password') {
        setError('Password must be at least 6 characters.');
      } else if (code === 'auth/invalid-email') {
        setError('Invalid email address.');
      } else {
        setError(firebaseError.message || 'Authentication failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const containerStyle: React.CSSProperties = {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-background)',
    position: 'relative',
    overflow: 'hidden',
  };

  const innerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 40,
  };

  const buttonBaseStyle: React.CSSProperties = {
    width: 280,
    height: 44,
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    cursor: loading ? 'default' : 'pointer',
    fontSize: 14,
    fontWeight: 500,
    fontFamily: 'var(--font-family)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    transition: 'all 0.15s ease',
    opacity: loading ? 0.6 : 1,
  };

  const authButtonStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
  };

  const inputStyle: React.CSSProperties = {
    width: 280,
    height: 40,
    padding: '0 12px',
    fontSize: 14,
    fontFamily: 'var(--font-family)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
    borderRadius: 8,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const submitButtonStyle: React.CSSProperties = {
    width: 280,
    height: 40,
    borderRadius: 8,
    border: 'none',
    background: 'var(--color-accent)',
    color: 'var(--color-background)',
    fontSize: 14,
    fontWeight: 600,
    fontFamily: 'var(--font-family)',
    cursor: loading ? 'default' : 'pointer',
    opacity: loading ? 0.6 : 1,
    transition: 'all 0.15s ease',
  };

  const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );

  const EmailIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
    </svg>
  );

  const GuestIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>
  );

  const renderButtons = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        style={authButtonStyle}
        onClick={handleGoogleSignIn}
        disabled={loading}
        onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'var(--color-hover)'; }}
        onMouseLeave={e => { if (!loading) e.currentTarget.style.background = 'var(--color-surface)'; }}
      >
        <GoogleIcon />
        Sign in with Google
      </button>

      <button
        style={authButtonStyle}
        onClick={() => { setMode('email'); setError(null); }}
        disabled={loading}
        onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'var(--color-hover)'; }}
        onMouseLeave={e => { if (!loading) e.currentTarget.style.background = 'var(--color-surface)'; }}
      >
        <EmailIcon />
        Sign in with Email
      </button>

      <button
        style={authButtonStyle}
        onClick={handleGuestSignIn}
        disabled={loading}
        onMouseEnter={e => { if (!loading) e.currentTarget.style.background = 'var(--color-hover)'; }}
        onMouseLeave={e => { if (!loading) e.currentTarget.style.background = 'var(--color-surface)'; }}
      >
        <GuestIcon />
        Continue as Guest
      </button>
    </div>
  );

  const renderEmailForm = () => (
    <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        style={inputStyle}
        autoFocus
        required
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        style={inputStyle}
        required
        minLength={6}
      />
      <button type="submit" style={submitButtonStyle} disabled={loading}>
        {loading ? '...' : emailMode === 'signup' ? 'Create Account' : 'Sign In'}
      </button>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--color-text-muted)' }}>
        <button
          type="button"
          onClick={() => {
            setEmailMode(emailMode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-accent)',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-family)',
            padding: 0,
          }}
        >
          {emailMode === 'signin' ? 'Create an account' : 'Already have an account?'}
        </button>
        <button
          type="button"
          onClick={() => { setMode('buttons'); setError(null); }}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-family)',
            padding: 0,
          }}
        >
          Back
        </button>
      </div>
    </form>
  );

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flameRef = useRef<SVGPathElement | null>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(performance.now());

  const drawGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    // Read accent color from CSS variable
    const accentRaw = getComputedStyle(canvas).getPropertyValue('--color-accent').trim();
    // Parse hex or rgb to get r,g,b
    let r = 255, g = 120, b = 50;
    if (accentRaw.startsWith('#')) {
      const hex = accentRaw.slice(1);
      const full = hex.length === 3
        ? hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]
        : hex;
      r = parseInt(full.slice(0, 2), 16);
      g = parseInt(full.slice(2, 4), 16);
      b = parseInt(full.slice(4, 6), 16);
    } else {
      const m = accentRaw.match(/(\d+)/g);
      if (m && m.length >= 3) {
        r = parseInt(m[0]); g = parseInt(m[1]); b = parseInt(m[2]);
      }
    }

    const spacing = 24;
    const dotRadius = 1;
    // Flame center: roughly 50% x, 42% y of the container
    const cx = w * 0.5;
    const cy = h * 0.42;
    // Max distance from center to any corner
    const maxDist = Math.sqrt(
      Math.max(cx, w - cx) ** 2 + Math.max(cy, h - cy) ** 2
    );

    const CYCLE = 3000; // ms, matches flame-breathe
    const elapsed = performance.now() - startTimeRef.current;
    const phase = (elapsed % CYCLE) / CYCLE;

    // Breath: 0→1→0 smooth sine, synced with flame-breathe
    const breath = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);

    // The "reach" of the glow — how far from center it extends
    // At breath=0 (flame small), glow barely exists. At breath=1 (flame peak), glow fills outward.
    const reach = breath * maxDist * 1.1;

    ctx.clearRect(0, 0, w, h);

    for (let x = spacing / 2; x < w; x += spacing) {
      for (let y = spacing / 2; y < h; y += spacing) {
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        const normalizedDist = dist / maxDist;

        // Dot is visible if it's within the current reach
        // Smooth falloff at the edge of the reach
        const withinReach = reach > 0 ? Math.max(0, 1 - dist / reach) : 0;

        // Near flame: invisible. Ramp up further out from center.
        const proximityFade = Math.pow(Math.min(normalizedDist / 0.5, 1), 1.5);

        // Intensity peaks at mid-to-far range, soft at leading edge
        const alpha = Math.min(1, withinReach * proximityFade * breath * 0.55);

        if (alpha > 0.005) {
          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Drive flame transform from same time base
    const flame = flameRef.current;
    if (flame) {
      const scale = 1 + 0.18 * breath;
      const ty = -2.5 * breath;
      const opacity = 0.85 + 0.15 * breath;
      flame.style.transform = `scale(${scale}) translateY(${ty}px)`;
      flame.style.opacity = String(opacity);
    }

    animRef.current = requestAnimationFrame(drawGrid);
  }, []);

  useEffect(() => {
    animRef.current = requestAnimationFrame(drawGrid);
    return () => cancelAnimationFrame(animRef.current);
  }, [drawGrid]);

  return (
    <div style={containerStyle}>
      {/* Dot grid with smooth ripple glow from flame center */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

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

      <div style={{ ...innerStyle, zIndex: 1 }}>
        <FariaWordmark height={80} animate flameRef={flameRef} />

        {mode === 'buttons' ? renderButtons() : renderEmailForm()}

        {error && (
          <p style={{
            marginTop: 16,
            fontSize: 12,
            color: '#e94560',
            maxWidth: 280,
            textAlign: 'center',
            lineHeight: 1.4,
          }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default SignIn;
