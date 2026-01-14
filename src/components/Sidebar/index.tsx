import React from 'react';
import { MdDescription, MdBuild, MdSettings } from 'react-icons/md';

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
        <MdDescription size={20} />
      </button>
      <button
        className={`sidebar-tab ${activeTab === 'toolbox' ? 'active' : ''}`}
        onClick={() => onTabChange('toolbox')}
        title="Toolbox"
      >
        <MdBuild size={20} />
      </button>
      <button
        className={`sidebar-tab ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => onTabChange('settings')}
        title="Settings"
      >
        <MdSettings size={20} />
      </button>
    </nav>
  );
}

export default Sidebar;

