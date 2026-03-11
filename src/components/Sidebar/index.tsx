import { useState, useRef, useCallback, useEffect } from 'react';
import { MdSettings } from 'react-icons/md';
import { IoMdHome } from 'react-icons/io';
import { auth } from '../../lib/firebase';
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
  activeTab: 'home' | 'settings';
  onTabChange: (tab: 'home' | 'settings') => void;
  userProfile: UserProfile | null;
  expanded: boolean;
}

function Sidebar({ activeTab, onTabChange, userProfile, expanded }: SidebarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const flameRef = useRef<SVGPathElement>(null);
  const iconFlameRef = useRef<SVGPathElement>(null);
  const logoContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const iconFlame = iconFlameRef.current;
    const logoContainer = logoContainerRef.current;

    const clearFlameAnimation = () => {
      const svg = iconFlame?.closest('svg');
      svg?.classList.remove('flame-breathing');
    };
    const clearLogoAnimation = () => logoContainer?.classList.remove('logo-breathing');

    iconFlame?.addEventListener('animationend', clearFlameAnimation);
    logoContainer?.addEventListener('animationend', clearLogoAnimation);

    return () => {
      iconFlame?.removeEventListener('animationend', clearFlameAnimation);
      logoContainer?.removeEventListener('animationend', clearLogoAnimation);
    };
  }, []);

  const handleLogoClick = useCallback(() => {
    if (!expanded) {
      const flame = iconFlameRef.current;
      const svg = flame?.closest('svg');
      if (!svg) return;
      svg.classList.remove('flame-breathing');
      void svg.getBBox();
      svg.classList.add('flame-breathing');
    } else {
      const container = logoContainerRef.current;
      if (!container) return;
      container.classList.remove('logo-breathing');
      void container.offsetWidth;
      container.classList.add('logo-breathing');
    }
  }, [expanded]);

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

      {/* Logo — flame icon when collapsed, full wordmark when expanded */}
      <div ref={logoContainerRef} className="sidebar-logo" onClick={handleLogoClick} style={{ cursor: 'pointer' }}>
        <FariaLogo size={28} className="sidebar-logo-icon" flameRef={iconFlameRef} />
        {expanded && <FariaWordmark height={36} className="sidebar-logo-wordmark" flameRef={flameRef} />}
      </div>

      <button
        className={`sidebar-tab ${activeTab === 'home' ? 'active' : ''}`}
        onClick={() => onTabChange('home')}
        title="Home"
      >
        <IoMdHome size={20} />
        <span className="sidebar-label">Home</span>
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
            {isGuest ? 'Guest' : userProfile.displayName?.split(' ')[0] || userProfile.email}
          </span>
        </button>
      )}
    </nav>
  );
}

export default Sidebar;
