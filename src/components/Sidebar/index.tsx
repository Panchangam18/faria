import { useState } from 'react';
import { MdHistory, MdSettings } from 'react-icons/md';
import FariaLogo from '../FariaLogo';
import FariaWordmark from '../FariaWordmark';

interface UserProfile {
  email: string;
  uid: string;
  displayName: string | null;
  photoUrl: string | null;
  provider: string | null;
}

interface SidebarProps {
  activeTab: 'history' | 'settings' | 'account';
  onTabChange: (tab: 'history' | 'settings' | 'account') => void;
  userProfile: UserProfile | null;
  expanded: boolean;
}

function Sidebar({ activeTab, onTabChange, userProfile, expanded }: SidebarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const initial = userProfile?.displayName
    ? userProfile.displayName.charAt(0).toUpperCase()
    : userProfile?.email === 'guest'
      ? 'G'
      : userProfile?.email
        ? userProfile.email.charAt(0).toUpperCase()
        : '?';

  return (
    <nav className={`sidebar ${expanded ? 'sidebar-expanded' : ''}`}>
      {/* Spacer for traffic lights + toggle area */}
      <div className="sidebar-header" />

      {/* Faria logo — commented out for now
      <div className="sidebar-logo">
        <FariaLogo size={34} className="sidebar-logo-icon" />
        <FariaWordmark height={24} className="sidebar-logo-wordmark" />
      </div>
      */}

      <button
        className={`sidebar-tab ${activeTab === 'history' ? 'active' : ''}`}
        onClick={() => onTabChange('history')}
        title="History"
      >
        <MdHistory size={24} />
        <span className="sidebar-label">History</span>
      </button>
      <button
        className={`sidebar-tab ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => onTabChange('settings')}
        title="Settings"
      >
        <MdSettings size={24} />
        <span className="sidebar-label">Settings</span>
      </button>

      {/* Spacer pushes profile to bottom */}
      <div style={{ flex: 1 }} />

      {/* Profile button */}
      {userProfile && (
        <button
          className={`sidebar-tab sidebar-profile ${activeTab === 'account' ? 'active' : ''}`}
          onClick={() => onTabChange('account')}
          title={userProfile.displayName || userProfile.email}
        >
          {userProfile.photoUrl && !imgFailed ? (
            <img
              src={userProfile.photoUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                objectFit: 'cover',
                flexShrink: 0,
              }}
            />
          ) : (
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--color-accent)',
              color: 'var(--color-background)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 600,
              flexShrink: 0,
              fontFamily: 'var(--font-family)',
            }}>
              {initial}
            </div>
          )}
          <div className="sidebar-label" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, lineHeight: 1.2 }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>
              {userProfile.displayName || (userProfile.email === 'guest' ? 'Guest' : userProfile.email.split('@')[0])}
            </span>
            {userProfile.email !== 'guest' && (
              <span className="sidebar-profile-email" style={{ fontSize: 10 }}>
                {userProfile.email}
              </span>
            )}
          </div>
        </button>
      )}
    </nav>
  );
}

export default Sidebar;
