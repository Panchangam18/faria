import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { MdSettings } from 'react-icons/md';
import { IoMdHome } from 'react-icons/io';
import { auth } from '../../lib/firebase';
import FariaLogo from '../FariaLogo';


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
  const iconFlameRef = useRef<SVGPathElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // Measure natural content width and set CSS variable for dynamic sidebar width.
  // We measure continuously (not just on expand) so the variable is already correct
  // before the CSS transition starts — this prevents a two-step jerk.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const measure = () => {
      // Clone the nav off-screen with no width constraint to measure natural width
      const clone = nav.cloneNode(true) as HTMLElement;
      clone.classList.add('sidebar-expanded');
      clone.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:max-content;visibility:hidden;pointer-events:none;';
      document.body.appendChild(clone);
      const contentWidth = clone.scrollWidth + 20; // 20px margin
      document.body.removeChild(clone);
      document.documentElement.style.setProperty('--sidebar-expanded-width', `${contentWidth}px`);
    };

    measure();

    // Re-measure if children change (e.g. profile name loads async)
    const mo = new MutationObserver(measure);
    mo.observe(nav, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    const iconFlame = iconFlameRef.current;

    const clearFlameAnimation = () => {
      const svg = iconFlame?.closest('svg');
      svg?.classList.remove('flame-breathing');
    };

    iconFlame?.addEventListener('animationend', clearFlameAnimation);

    return () => {
      iconFlame?.removeEventListener('animationend', clearFlameAnimation);
    };
  }, []);

  const handleLogoClick = useCallback(() => {
    const flame = iconFlameRef.current;
    const svg = flame?.closest('svg');
    if (svg) {
      svg.classList.remove('flame-breathing');
      void svg.getBBox();
      svg.classList.add('flame-breathing');
    }
  }, []);

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
    <nav ref={navRef} className={`sidebar ${expanded ? 'sidebar-expanded' : ''}`}>
      {/* Spacer for traffic lights + toggle area */}
      <div className="sidebar-header" />

      {/* Logo — flame icon always visible, text "Faria" appears when expanded */}
      <div className="sidebar-logo" onClick={handleLogoClick} style={{ cursor: 'pointer' }}>
        <FariaLogo size={28} className="sidebar-logo-icon" flameRef={iconFlameRef} />
        <span className="sidebar-logo-text">Faria</span>
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
