import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import HistoryPanel from './components/Sidebar/HistoryPanel';
import SettingsPanel from './components/Settings/SettingsPanel';

type Tab = 'history' | 'settings';

const PRESET_THEMES = [
  {
    id: 'default',
    name: 'Chateau',
    colors: { background: '#272932', text: '#EAE0D5', accent: '#C6AC8F' },
  },
  {
    id: 'comte',
    name: 'Comte',
    colors: { background: '#07020D', text: '#FBFFFE', accent: '#3C91E6' },
  },
  {
    id: 'mercedes',
    name: 'Mercédès',
    colors: { background: '#46494C', text: '#DCDCDD', accent: '#9883E5' },
  },
  {
    id: 'carnival',
    name: 'Carnival',
    colors: { background: '#001011', text: '#6CCFF6', accent: '#E94560' },
  },
];

const deriveAccentColors = (accent: string): { hover: string; active: string } => {
  const hex = accent.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const hoverFactor = brightness > 128 ? 0.85 : 1.15;
  const activeFactor = brightness > 128 ? 0.75 : 1.25;
  const hoverR = Math.min(255, Math.max(0, Math.round(r * hoverFactor)));
  const hoverG = Math.min(255, Math.max(0, Math.round(g * hoverFactor)));
  const hoverB = Math.min(255, Math.max(0, Math.round(b * hoverFactor)));
  const activeR = Math.min(255, Math.max(0, Math.round(r * activeFactor)));
  const activeG = Math.min(255, Math.max(0, Math.round(g * activeFactor)));
  const activeB = Math.min(255, Math.max(0, Math.round(b * activeFactor)));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return {
    hover: `#${toHex(hoverR)}${toHex(hoverG)}${toHex(hoverB)}`,
    active: `#${toHex(activeR)}${toHex(activeG)}${toHex(activeB)}`
  };
};

const applyThemeColors = (colors: { background: string; text: string; accent: string }, themeId: string) => {
  const accentColors = deriveAccentColors(colors.accent);
  const bgHex = colors.background.replace('#', '');
  const bgR = parseInt(bgHex.substring(0, 2), 16);
  const bgG = parseInt(bgHex.substring(2, 4), 16);
  const bgB = parseInt(bgHex.substring(4, 6), 16);
  const lightR = Math.min(255, Math.round(bgR * 1.2));
  const lightG = Math.min(255, Math.round(bgG * 1.2));
  const lightB = Math.min(255, Math.round(bgB * 1.2));
  const darkR = Math.max(0, Math.round(bgR * 0.7));
  const darkG = Math.max(0, Math.round(bgG * 0.7));
  const darkB = Math.max(0, Math.round(bgB * 0.7));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');

  document.documentElement.style.setProperty('--color-primary', colors.background);
  document.documentElement.style.setProperty('--color-secondary', colors.text);
  document.documentElement.style.setProperty('--color-accent', colors.accent);
  document.documentElement.style.setProperty('--color-primary-light', `#${toHex(lightR)}${toHex(lightG)}${toHex(lightB)}`);
  document.documentElement.style.setProperty('--color-primary-dark', `#${toHex(darkR)}${toHex(darkG)}${toHex(darkB)}`);
  document.documentElement.style.setProperty('--color-secondary-muted', colors.text + 'B3');
  document.documentElement.style.setProperty('--color-accent-hover', accentColors.hover);
  document.documentElement.style.setProperty('--color-accent-active', accentColors.active);
  document.documentElement.style.setProperty('--color-background', colors.background);
  document.documentElement.style.setProperty('--color-surface', `#${toHex(lightR)}${toHex(lightG)}${toHex(lightB)}`);
  document.documentElement.style.setProperty('--color-text', colors.text);
  document.documentElement.style.setProperty('--color-text-muted', colors.text + 'B3');
  document.documentElement.style.setProperty('--color-border', colors.text + '26');
  document.documentElement.style.setProperty('--color-hover', colors.text + '14');
  document.documentElement.setAttribute('data-theme', themeId);
};

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('history');
  const [theme, setTheme] = useState<string>('default');

  useEffect(() => {
    const loadTheme = async () => {
      // Get theme data from main process (single source of truth for colors)
      const themeData = await window.faria.settings.getThemeData();
      setTheme(themeData.theme);
      applyThemeColors(themeData.colors, themeData.theme);
    };
    loadTheme();
  }, []);

  const handleThemeChange = async (newTheme: string) => {
    setTheme(newTheme);
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

