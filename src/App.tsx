import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import HistoryPanel from './components/Sidebar/HistoryPanel';
import SettingsPanel from './components/Settings/SettingsPanel';

type Tab = 'history' | 'settings';

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
        
        // Apply preset theme font if not custom
        if (savedTheme !== 'custom') {
          const PRESET_THEMES = [
            { 
              id: 'default', 
              font: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            },
            { 
              id: 'midnight', 
              font: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            },
            { 
              id: 'forest', 
              font: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            },
          ];
          const presetTheme = PRESET_THEMES.find(t => t.id === savedTheme);
          if (presetTheme?.font) {
            document.documentElement.style.setProperty('--font-family', presetTheme.font);
          }
        }
      }
    };
    loadTheme();
  }, []);

  const handleThemeChange = async (newTheme: string) => {
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    
    // Clear custom CSS variables if switching to a preset theme
    if (newTheme !== 'custom') {
      document.documentElement.style.removeProperty('--color-primary');
      document.documentElement.style.removeProperty('--color-secondary');
      document.documentElement.style.removeProperty('--color-accent');
      document.documentElement.style.removeProperty('--color-primary-light');
      document.documentElement.style.removeProperty('--color-primary-dark');
      document.documentElement.style.removeProperty('--color-secondary-muted');
      document.documentElement.style.removeProperty('--color-accent-hover');
      document.documentElement.style.removeProperty('--color-accent-active');
      document.documentElement.style.removeProperty('--color-background');
      document.documentElement.style.removeProperty('--color-surface');
      document.documentElement.style.removeProperty('--color-text');
      document.documentElement.style.removeProperty('--color-text-muted');
      document.documentElement.style.removeProperty('--color-border');
      document.documentElement.style.removeProperty('--color-hover');
      
      // Apply preset theme font
      const PRESET_THEMES = [
        { 
          id: 'default', 
          font: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        },
        { 
          id: 'midnight', 
          font: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        },
        { 
          id: 'forest', 
          font: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        },
      ];
      const presetTheme = PRESET_THEMES.find(t => t.id === newTheme);
      if (presetTheme?.font) {
        document.documentElement.style.setProperty('--font-family', presetTheme.font);
      }
    }
    
    await window.faria.settings.set('theme', newTheme);
  };

  return (
    <div className="app">
      <div className="app-header"></div>
      
      <div className="app-content">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
        
        <main className="main-panel">
          {activeTab === 'history' && <HistoryPanel />}
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

