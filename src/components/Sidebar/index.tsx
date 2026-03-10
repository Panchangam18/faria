import { useState } from 'react';
import { MdHistory, MdSettings } from 'react-icons/md';
import { auth } from '../../lib/firebase';

interface UserProfile {
  email: string;
  uid: string;
  displayName: string | null;
  photoUrl: string | null;
  provider: string | null;
}

interface SidebarProps {
  activeTab: 'history' | 'settings';
  onTabChange: (tab: 'history' | 'settings') => void;
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

  const isGuest = userProfile?.email === 'guest';

  const handleProfileClick = async () => {
    const action = await window.faria.menu.profile();
    if (action === 'sign-out') {
      try {
        await auth.signOut();
      } catch {
        // Ignore Firebase sign-out errors
      }
      await window.faria.auth.signOut();
      window.location.reload();
    }
  };

  return (
    <nav className={`sidebar ${expanded ? 'sidebar-expanded' : ''}`}>
      {/* Spacer for traffic lights + toggle area */}
      <div className="sidebar-header" />

      <button
        className={`sidebar-tab ${activeTab === 'history' ? 'active' : ''}`}
        onClick={() => onTabChange('history')}
        title="History"
      >
        <MdHistory size={20} />
        <span className="sidebar-label">History</span>
      </button>
      <button
        className={`sidebar-tab ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => onTabChange('settings')}
        title="Settings"
      >
        <MdSettings size={20} />
        <span className="sidebar-label">Settings</span>
      </button>

      {/* Spacer pushes profile to bottom */}
      <div style={{ flex: 1 }} />

      {/* Profile button — opens native context menu */}
      {userProfile && (
        <button
          className="sidebar-tab sidebar-profile"
          onClick={handleProfileClick}
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
          <span className="sidebar-label" style={{ fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {isGuest ? 'Guest' : userProfile.email}
          </span>
        </button>
      )}
    </nav>
  );
}

export default Sidebar;
