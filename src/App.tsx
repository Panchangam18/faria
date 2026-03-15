import React, { useState, useEffect, useRef } from 'react';
import { BsLayoutSidebar } from 'react-icons/bs';
import { MdHelpOutline } from 'react-icons/md';
import { IoMdSend } from 'react-icons/io';
import Sidebar from './components/Sidebar';
import HistoryPanel from './components/Sidebar/HistoryPanel';
import SettingsPanel from './components/Settings/SettingsPanel';
import ChatPanel from './components/Chat/ChatPanel';

import SignIn from './components/SignIn';

type Tab = 'home' | 'chat' | 'settings';

interface UserProfile {
  email: string;
  uid: string;
  displayName: string | null;
  photoUrl: string | null;
  provider: string | null;
}

const applyTheme = (themeId: string) => {
  // Clear any legacy inline color overrides so CSS [data-theme] selectors take effect
  const colorProps = [
    '--color-primary', '--color-secondary', '--color-accent',
    '--color-primary-light', '--color-primary-dark',
    '--color-secondary-muted', '--color-accent-hover', '--color-accent-active',
    '--color-background', '--color-surface', '--color-text', '--color-text-muted',
    '--color-border', '--color-hover',
  ];
  for (const prop of colorProps) {
    document.documentElement.style.removeProperty(prop);
  }
  document.documentElement.setAttribute('data-theme', themeId === 'default' ? '' : themeId);
  // Persist so the inline script in index.html can apply it before next paint
  localStorage.setItem('faria-theme', themeId);
};

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [theme, setTheme] = useState<string>('default');
  const [userAuth, setUserAuth] = useState<UserProfile | null | undefined>(undefined);

  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpMessage, setHelpMessage] = useState('');
  const mainPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mainPanelRef.current?.scrollTo(0, 0);
    window.faria.chat.reportActiveTab(activeTab);
  }, [activeTab]);

  useEffect(() => {
    const init = async () => {
      const user = await window.faria.auth.getUser();
      setUserAuth(user);

      const themeData = await window.faria.settings.getThemeData();
      setTheme(themeData.theme);
      applyTheme(themeData.theme);
    };
    init();
  }, []);

  useEffect(() => {
    return window.faria.window.onFullscreenChange((fs) => {
      setIsFullscreen(fs);
    });
  }, []);

  // Report text selection to main process so the command bar can show char count
  useEffect(() => {
    const handler = () => {
      const text = window.getSelection()?.toString() || '';
      window.faria.selection.report(text);
    };
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, []);

  const handleThemeChange = async (newTheme: string) => {
    setTheme(newTheme);
    await window.faria.settings.set('theme', newTheme);
  };

  if (userAuth === undefined) return null;

  if (userAuth === null) {
    return (
      <SignIn onSignIn={async () => {
        const user = await window.faria.auth.getUser();
        // Resize first (hides window), then update state so new content renders into the resized window
        await window.faria.window.setSize(1200, 800);
        setUserAuth(user);
      }} />
    );
  }

  return (
    <div className={`app ${isFullscreen ? 'app-fullscreen' : ''}`}>
      <div className="accent-splotch-container">
        <div className="accent-splotch accent-splotch-1" />
        <div className="accent-splotch accent-splotch-2" />
        <div className="accent-splotch accent-splotch-3" />
        <div className="accent-splotch accent-splotch-4" />
        <div className="accent-splotch accent-splotch-5" />
        <div className="accent-splotch accent-splotch-6" />
      </div>

      <div className="app-header"></div>

      <button
        className="sidebar-toggle"
        onClick={() => setSidebarExpanded(e => !e)}
        title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <BsLayoutSidebar size={15} />
      </button>

      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} userProfile={userAuth} expanded={sidebarExpanded} />

      <button
        className="help-toggle"
        onClick={() => setHelpOpen(true)}
        title="Help"
      >
        <MdHelpOutline size={18} />
      </button>

      <div className="app-content">
        <main className="main-panel" ref={mainPanelRef}>
          <div className="main-panel-inner">
            {activeTab === 'home' && <HistoryPanel userProfile={userAuth} />}
            {activeTab === 'chat' && <ChatPanel userProfile={userAuth} />}
            {activeTab === 'settings' && (
              <SettingsPanel
                currentTheme={theme}
                onThemeChange={handleThemeChange}
              />
            )}
          </div>
        </main>
      </div>

      {helpOpen && (
        <div className="help-modal-overlay" onClick={() => setHelpOpen(false)}>
          <div className="help-modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <MdHelpOutline size={20} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
              <span className="help-modal-title" style={{ marginBottom: 0 }}>Need Help?</span>
            </div>
            <textarea
              className="help-modal-textarea"
              placeholder="Send us a message..."
              value={helpMessage}
              onChange={(e) => setHelpMessage(e.target.value)}
              rows={4}
              style={{ marginTop: '10px' }}
            />
            <div className="help-modal-footer">
              <button
                className="help-modal-send"
                disabled={!helpMessage.trim()}
                onClick={() => {
                  setHelpMessage('');
                  setHelpOpen(false);
                }}
              >
                <IoMdSend />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

