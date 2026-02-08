import { useState, useEffect } from 'react';
import { applyTheme } from './utils';

export function useTheme() {
  const [opacity, setOpacity] = useState(0.7);
  const [backgroundColor, setBackgroundColor] = useState('#272932');

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const themeData = await window.faria.settings.getThemeData();
        applyTheme(themeData.theme, themeData.colors, themeData.font);
        setBackgroundColor(themeData.colors.background);

        const savedOpacity = await window.faria.settings.get('commandBarOpacity');
        if (savedOpacity) {
          setOpacity(parseFloat(savedOpacity));
        }
      } catch {
        // Defaults are already set
      }
    };

    loadSettings();

    const cleanupTheme = window.faria.settings.onThemeChange((themeData) => {
      applyTheme(themeData.theme, themeData.colors, themeData.font);
      setBackgroundColor(themeData.colors.background);
    });

    const cleanupOpacity = window.faria.settings.onOpacityChange((newOpacity) => {
      setOpacity(newOpacity);
    });

    return () => {
      cleanupTheme();
      cleanupOpacity();
    };
  }, []);

  return { backgroundColor, opacity };
}
