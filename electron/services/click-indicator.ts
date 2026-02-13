import { BrowserWindow } from 'electron';
import { initDatabase } from '../db/sqlite';

let indicatorWindow: BrowserWindow | null = null;

// Preset theme accent colors (mirrors main.ts PRESET_THEMES)
const PRESET_ACCENTS: Record<string, string> = {
  default: '#C6AC8F',
  comte: '#3C91E6',
  mercedes: '#9883E5',
  carnival: '#E94560',
};

/**
 * Read the current accent color from the database
 */
function getAccentColor(): string {
  try {
    const db = initDatabase();
    const themeRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as { value: string } | undefined;
    const theme = themeRow?.value || 'default';

    if (theme === 'custom') {
      const customPalettesRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('customPalettes') as { value: string } | undefined;
      const activeCustomPaletteRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('activeCustomPalette') as { value: string } | undefined;
      if (customPalettesRow?.value && activeCustomPaletteRow?.value) {
        try {
          const palettes = JSON.parse(customPalettesRow.value);
          const activePalette = palettes.find((p: any) => p.name === activeCustomPaletteRow.value);
          if (activePalette?.accent) return activePalette.accent;
        } catch { /* fall through to default */ }
      }
    }

    return PRESET_ACCENTS[theme] || PRESET_ACCENTS.default;
  } catch {
    return PRESET_ACCENTS.default;
  }
}

/**
 * Build the inline HTML for the pulsing click indicator.
 * Three expanding rings + a center dot, all in the accent color.
 */
function getIndicatorHTML(color: string): string {
  return `<!DOCTYPE html>
<html><head><style>
*{margin:0;padding:0}
html,body{width:100%;height:100%;background:transparent;overflow:hidden}
.c{width:100%;height:100%;display:flex;align-items:center;justify-content:center;position:relative}
.dot{width:10px;height:10px;border-radius:50%;background:${color};position:absolute;animation:pd 1.5s ease-in-out infinite}
.ring{position:absolute;width:18px;height:18px;border:2px solid ${color};border-radius:50%;animation:pr 1.5s ease-out infinite;opacity:0}
.ring:nth-child(2){animation-delay:.5s}
.ring:nth-child(3){animation-delay:1s}
@keyframes pr{0%{transform:scale(1);opacity:.8}100%{transform:scale(4);opacity:0}}
@keyframes pd{0%,100%{opacity:.4;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
</style></head><body><div class="c">
<div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="dot"></div>
</div></body></html>`;
}

/**
 * Show a pulsing click indicator overlay at the given screen coordinates.
 * The indicator is a small transparent always-on-top window that is
 * click-through (ignoreMouseEvents) so it doesn't interfere with the user.
 *
 * @param x Logical screen x coordinate (center of indicator)
 * @param y Logical screen y coordinate (center of indicator)
 */
export function showClickIndicator(x: number, y: number): void {
  hideClickIndicator();

  const accentColor = getAccentColor();
  const size = 100;

  try {
    indicatorWindow = new BrowserWindow({
      width: size,
      height: size,
      x: Math.round(x - size / 2),
      y: Math.round(y - size / 2),
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      roundedCorners: false,
      fullscreenable: false,
      type: 'panel',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    indicatorWindow.setAlwaysOnTop(true, 'floating', 2);
    indicatorWindow.setVisibleOnAllWorkspaces(true);
    indicatorWindow.setIgnoreMouseEvents(true);

    const html = getIndicatorHTML(accentColor);
    indicatorWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    indicatorWindow.showInactive();

    indicatorWindow.on('closed', () => {
      indicatorWindow = null;
    });
  } catch (e) {
    console.error('[Faria] Failed to show click indicator:', e);
    indicatorWindow = null;
  }
}

/**
 * Hide and destroy the click indicator overlay.
 */
export function hideClickIndicator(): void {
  if (indicatorWindow && !indicatorWindow.isDestroyed()) {
    indicatorWindow.destroy();
  }
  indicatorWindow = null;
}
