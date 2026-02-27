import React, { useState } from 'react';
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
    alignItems: 'center',
    width: '100%',
    maxWidth: 720,
  };

  const leftStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const rightStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 48px',
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

      <div style={innerStyle}>
        <div style={leftStyle}>
          <div style={{ marginTop: -20 }}>
            <FariaWordmark height={80} />
          </div>
        </div>

        {/* Vertical divider */}
        <div style={{
          width: 1,
          background: 'var(--color-border)',
          alignSelf: 'center',
          height: '75%',
        }} />

        <div style={rightStyle}>
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
    </div>
  );
}

export default SignIn;
