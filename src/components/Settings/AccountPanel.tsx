import React, { useState } from 'react';
import { auth } from '../../lib/firebase';
import { updateProfile, updateEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';

interface UserProfile {
  email: string;
  uid: string;
  displayName: string | null;
  photoUrl: string | null;
  provider: string | null;
}

interface AccountPanelProps {
  userProfile: UserProfile;
}

function AccountPanel({ userProfile }: AccountPanelProps) {
  const [displayName, setDisplayName] = useState(userProfile.displayName || '');
  const [newEmail, setNewEmail] = useState(userProfile.email === 'guest' ? '' : userProfile.email);
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [saving, setSaving] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const isEmailProvider = userProfile.provider === 'email';
  const isGuest = userProfile.email === 'guest';

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-sm)',
    color: 'var(--color-text-muted)',
    marginBottom: 'var(--spacing-sm)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    fontWeight: 500,
    paddingLeft: 'var(--spacing-sm)',
    paddingTop: 'var(--spacing-sm)',
    paddingBottom: 'var(--spacing-sm)',
  };

  const inputStyle: React.CSSProperties = {
    width: 280,
    height: 36,
    padding: '0 12px',
    fontSize: 13,
    fontFamily: 'var(--font-family)',
    background: 'var(--color-background)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '6px 16px',
    fontSize: 12,
    fontWeight: 500,
    fontFamily: 'var(--font-family)',
    background: 'var(--color-accent)',
    color: 'var(--color-background)',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  };

  const handleSaveName = async () => {
    setSaving(true);
    setMessage(null);
    try {
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName });
      }
      await window.faria.settings.set('userDisplayName', displayName);
      setMessage({ text: 'Name updated.', type: 'success' });
    } catch {
      setMessage({ text: 'Failed to update name.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!currentPassword) {
      setMessage({ text: 'Enter your current password to change email.', type: 'error' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const user = auth.currentUser;
      if (user && user.email) {
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updateEmail(user, newEmail);
        await window.faria.settings.set('userEmail', newEmail);
        setCurrentPassword('');
        setMessage({ text: 'Email updated.', type: 'success' });
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setMessage({ text: 'Incorrect password.', type: 'error' });
      } else {
        setMessage({ text: 'Failed to update email.', type: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSavePassword = async () => {
    if (!currentPassword) {
      setMessage({ text: 'Enter your current password to set a new one.', type: 'error' });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ text: 'New password must be at least 6 characters.', type: 'error' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const user = auth.currentUser;
      if (user && user.email) {
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword);
        setCurrentPassword('');
        setNewPassword('');
        setMessage({ text: 'Password updated.', type: 'success' });
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setMessage({ text: 'Incorrect current password.', type: 'error' });
      } else {
        setMessage({ text: 'Failed to update password.', type: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await auth.signOut();
    } catch {
      // Ignore Firebase sign-out errors
    }
    await window.faria.auth.signOut();
    window.location.reload();
  };

  return (
    <div className="settings-panel">
      {/* Account Header */}
      <section style={{ marginBottom: 'var(--spacing-xl)' }}>
        <div style={sectionHeaderStyle}>Account</div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginLeft: 'calc(var(--spacing-md) * 2)',
          marginBottom: 'var(--spacing-lg)',
        }}>
          {userProfile.photoUrl && !imgFailed ? (
            <img
              src={userProfile.photoUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <div style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'var(--color-accent)',
              color: 'var(--color-background)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
              fontWeight: 600,
              fontFamily: 'var(--font-family)',
            }}>
              {(userProfile.displayName || userProfile.email).charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--color-text)' }}>
              {userProfile.displayName || (isGuest ? 'Guest' : userProfile.email.split('@')[0])}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {isGuest ? 'Anonymous' : userProfile.email}
              {userProfile.provider && (
                <span style={{ marginLeft: 8, opacity: 0.6 }}>
                  via {userProfile.provider}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Display Name */}
      {!isGuest && (
        <section style={{ marginBottom: 'var(--spacing-xl)' }}>
          <div style={sectionHeaderStyle}>Display Name</div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-sm)',
            marginLeft: 'calc(var(--spacing-md) * 2)',
          }}>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              style={inputStyle}
            />
            <button
              onClick={handleSaveName}
              disabled={saving}
              style={buttonStyle}
            >
              Save
            </button>
          </div>
        </section>
      )}

      {/* Email (only for email provider) */}
      {isEmailProvider && (
        <section style={{ marginBottom: 'var(--spacing-xl)' }}>
          <div style={sectionHeaderStyle}>Email</div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-sm)',
            marginLeft: 'calc(var(--spacing-md) * 2)',
          }}>
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="New email"
              style={inputStyle}
            />
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              style={inputStyle}
            />
            <div>
              <button
                onClick={handleSaveEmail}
                disabled={saving}
                style={buttonStyle}
              >
                Update Email
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Password (only for email provider) */}
      {isEmailProvider && (
        <section style={{ marginBottom: 'var(--spacing-xl)' }}>
          <div style={sectionHeaderStyle}>Password</div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--spacing-sm)',
            marginLeft: 'calc(var(--spacing-md) * 2)',
          }}>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              style={inputStyle}
            />
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="New password (min 6 chars)"
              style={inputStyle}
            />
            <div>
              <button
                onClick={handleSavePassword}
                disabled={saving}
                style={buttonStyle}
              >
                Update Password
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Status message */}
      {message && (
        <div style={{
          marginLeft: 'calc(var(--spacing-md) * 2)',
          marginBottom: 'var(--spacing-lg)',
          fontSize: 12,
          color: message.type === 'success' ? 'var(--color-accent)' : '#e94560',
        }}>
          {message.text}
        </div>
      )}

      {/* Sign Out */}
      <section>
        <div style={{ marginLeft: 'var(--spacing-md)' }}>
          <button
            onClick={handleSignOut}
            style={{
              ...buttonStyle,
              background: 'transparent',
              color: 'var(--color-text-muted)',
              border: '1px solid var(--color-border)',
            }}
          >
            Sign Out
          </button>
        </div>
      </section>
    </div>
  );
}

export default AccountPanel;
