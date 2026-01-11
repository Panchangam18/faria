import React from 'react';
import { FileText, Wrench, Settings } from 'lucide-react';

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
        <FileText size={20} />
      </button>
      <button
        className={`sidebar-tab ${activeTab === 'toolbox' ? 'active' : ''}`}
        onClick={() => onTabChange('toolbox')}
        title="Toolbox"
      >
        <Wrench size={20} />
      </button>
      <button
        className={`sidebar-tab ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => onTabChange('settings')}
        title="Settings"
      >
        <Settings size={20} />
      </button>
    </nav>
  );
}

export default Sidebar;

