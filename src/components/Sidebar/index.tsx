import { useState, useRef, useCallback, useEffect, useLayoutEffect } from 'react';
import { MdSettings } from 'react-icons/md';
import { IoMdCheckmark, IoMdHome } from 'react-icons/io';
import { IoMdChatbubbles } from 'react-icons/io';
import { IoGiftSharp } from 'react-icons/io5';
import { FaCopy } from 'react-icons/fa';
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
  activeTab: 'home' | 'chat' | 'settings';
  onTabChange: (tab: 'home' | 'chat' | 'settings') => void;
  userProfile: UserProfile | null;
  expanded: boolean;
}

function ReferralModal({ uid, onClose }: { uid: string; onClose: () => void }) {
  const referralUrl = `https://yourapp.com/join?ref=${uid}`;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="help-modal-overlay" onClick={onClose}>
      <div className="help-modal" onClick={e => e.stopPropagation()} style={{ minWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <IoGiftSharp size={20} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span className="help-modal-title" style={{ marginBottom: 0 }}>Refer a Friend</span>
        </div>
        <p className="help-modal-desc">Share your link and earn rewards when friends sign up.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            readOnly
            value={referralUrl}
            style={{
              flex: 1,
              padding: '8px 10px',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              fontSize: 'var(--font-size-sm)',
              fontFamily: 'var(--font-family)',
              outline: 'none',
            }}
            onFocus={e => e.target.select()}
          />
          <button
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy link'}
            title={copied ? 'Copied' : 'Copy link'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 40,
              height: 40,
              flexShrink: 0,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
          >
            {copied ? <IoMdCheckmark size={18} /> : <FaCopy size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ activeTab, onTabChange, userProfile, expanded }: SidebarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
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

    const clearFlameAnimation = (e: Event) => {
      const animEvent = e as AnimationEvent;
      if (animEvent.animationName !== 'flame-breathe') return;
      const svg = iconFlame?.closest('svg');
      if (svg) {
        svg.classList.remove('flame-breathing');
        void (svg as SVGSVGElement).getBBox();
      }
      document.querySelector('.app')?.classList.remove('splotch-breathing');
    };

    iconFlame?.closest('svg')?.addEventListener('animationend', clearFlameAnimation);

    return () => {
      iconFlame?.closest('svg')?.removeEventListener('animationend', clearFlameAnimation);
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
    const app = document.querySelector('.app');
    if (app) {
      app.classList.remove('splotch-breathing');
      void (app as HTMLElement).offsetWidth;
      app.classList.add('splotch-breathing');
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
        <FariaLogo size={28} noFilter className="sidebar-logo-icon" flameRef={iconFlameRef} />
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
        className={`sidebar-tab ${activeTab === 'chat' ? 'active' : ''}`}
        onClick={() => onTabChange('chat')}
        title="Chat"
      >
        <IoMdChatbubbles size={20} />
        <span className="sidebar-label">Chat</span>
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

      {/* Refer a friend button */}
      {userProfile && (
        <button
          className="sidebar-tab"
          onClick={() => setShowReferral(true)}
          title="Refer a Friend"
        >
          <IoGiftSharp size={20} />
          <span className="sidebar-label">Rewards</span>
        </button>
      )}

      {showReferral && userProfile && (
        <ReferralModal uid={userProfile.uid} onClose={() => setShowReferral(false)} />
      )}

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
          <span className="sidebar-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {isGuest ? 'Guest' : userProfile.displayName?.split(' ')[0] || userProfile.email}
          </span>
        </button>
      )}
    </nav>
  );
}

export default Sidebar;
