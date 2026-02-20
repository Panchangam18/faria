import React from 'react';
import { MdHistory, MdSettings } from 'react-icons/md';

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
    </nav>
  );
}

export default Sidebar;

