import React from 'react';
import { MdDescription, MdSettings } from 'react-icons/md';

interface SidebarProps {
  activeTab: 'history' | 'settings';
  onTabChange: (tab: 'history' | 'settings') => void;
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

