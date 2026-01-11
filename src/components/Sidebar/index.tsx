import React from 'react';

interface SidebarProps {
  activeTab: 'history' | 'toolbox' | 'settings';
  onTabChange: (tab: 'history' | 'toolbox' | 'settings') => void;
}

function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  return (
    <nav className="sidebar">
      <button
        className={`sidebar-tab ${activeTab === 'history' ? 'active' : ''}`}
        onClick={() => onTabChange('history')}
        title="History"
      >
        📜
      </button>
      <button
        className={`sidebar-tab ${activeTab === 'toolbox' ? 'active' : ''}`}
        onClick={() => onTabChange('toolbox')}
        title="Toolbox"
      >
        🧰
      </button>
      <button
        className={`sidebar-tab ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => onTabChange('settings')}
        title="Settings"
      >
        ⚙️
      </button>
    </nav>
  );
}

export default Sidebar;

