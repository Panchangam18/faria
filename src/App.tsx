import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import HistoryPanel from './components/Sidebar/HistoryPanel';
import ToolboxPanel from './components/Sidebar/ToolboxPanel';
import SettingsPanel from './components/Settings/SettingsPanel';

type Tab = 'history' | 'toolbox' | 'settings';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('history');
  const [theme, setTheme] = useState<string>('default');

  useEffect(() => {
    // Load theme from settings
    const loadTheme = async () => {
      const savedTheme = await window.faria.settings.get('theme');
      if (savedTheme) {
        setTheme(savedTheme);
        document.documentElement.setAttribute('data-theme', savedTheme);
      }
    };
    loadTheme();
  }, []);

  const handleThemeChange = async (newTheme: string) => {
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    await window.faria.settings.set('theme', newTheme);
  };

  return (
    <div className="app">
      <div className="app-header">
        <div className="app-title">
          <span className="app-logo">F</span>
          <span>FARIA</span>
        </div>
        <div className="app-subtitle">The copilot for work on a computer</div>
      </div>
      
      <div className="app-content">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
        
        <main className="main-panel">
          {activeTab === 'history' && <HistoryPanel />}
          {activeTab === 'toolbox' && <ToolboxPanel />}
          {activeTab === 'settings' && (
            <SettingsPanel 
              currentTheme={theme} 
              onThemeChange={handleThemeChange} 
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;

