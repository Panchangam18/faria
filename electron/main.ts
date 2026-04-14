import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron';
import { join } from 'path';
import { initDatabase } from './db/sqlite';
import { StateExtractor } from './services/state-extractor';
import { AgentLoop } from './agent/loop';
import { ToolExecutor } from './agent/tools';
import { ComposioService } from './services/composio';
import { getSelectedText } from './services/text-extraction';
import { exec } from 'child_process';
import { promisify } from 'util';
import { initEmbeddings } from './services/memory';
import { migrateToMarkdownMemory } from './services/memory/migrate-v2';

// Prevent EIO crashes when stdout/stderr are not connected (e.g. packaged app on another machine)
for (const stream of [process.stdout, process.stderr]) {
  stream?.on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EIO' || err.code === 'EPIPE') return;
    throw err;
  });
}

// Load .env in development only
try { require('dotenv').config(); } catch {}

const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;
let commandBarWindow: BrowserWindow | null = null;
let isCommandBarVisible = false;
let targetAppName: string | null = null; // The app that was focused when command bar was invoked
let currentSelectedText: string | null = null; // User-selected text when command bar was invoked
let mainWindowSelectedText: string | null = null; // Live selection from main window renderer
let cachedCommandBarPosition: { x: number; y: number } | null = null; // Cached position for instant toggle
let commandBarSessionId = 0; // Incremented on each open to cancel stale async operations
let toggleInProgress = false; // Prevents queued toggles while window is animating
let tray: Tray | null = null; // Menu bar tray icon

// Services
let stateExtractor: StateExtractor;
let agentLoop: AgentLoop;
let toolExecutor: ToolExecutor;
let composioService: ComposioService;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Native window helper for reliable window visibility on macOS
// Falls back gracefully if addon fails to load
let windowHelper: {
  forceShow: (handle: Buffer) => boolean;
  isVisible: (handle: Buffer) => boolean;
  makeNonActivating: (handle: Buffer) => boolean;
  stealKeyFocus: (handle: Buffer) => boolean;
} | null = null;
try {
  const addonPath = isDev
    ? join(process.cwd(), 'native/build/Release/window_helper.node')
    : join(process.resourcesPath!, 'native/window_helper.node');
  windowHelper = require(addonPath);
  console.log('[Faria] Native window helper loaded');
} catch (e) {
  console.warn('[Faria] Native window helper not available, using fallback:', e);
}

// Track if main window is visible (for Dock icon management)
let isMainWindowVisible = false;

// Track if the main window's active tab is 'chat' so the global shortcut can redirect
let mainWindowActiveTab: string = 'home';

// Command bar size modes
type CommandBarSizeMode = 'small' | 'medium' | 'large';

interface CommandBarLayoutPayload {
  inputAreaHeight: number;
  agentAreaHeight: number;
}

const COMMAND_BAR_SIZES: Record<CommandBarSizeMode, { width: number; minHeight: number; scale: number }> = {
  small:  { width: 350, minHeight: 39, scale: 1.0 },   // baseHeight(18) + lineHeight(21)
  medium: { width: 437, minHeight: 47, scale: 1.25 },   // baseHeight(22) + lineHeight(25)
  large:  { width: 525, minHeight: 56, scale: 1.5 },    // baseHeight(26) + lineHeight(30)
};

let currentSizeMode: CommandBarSizeMode = 'small';
let currentCommandBarWidth = COMMAND_BAR_SIZES.small.width;
let currentCommandBarMinHeight = COMMAND_BAR_SIZES.small.minHeight;
const COMMAND_BAR_FRAME_HEIGHT = 2; // 1px border on the top and bottom of the rendered bar
let dividerAnchorY: number | null = null;
let bottomAnchorY: number | null = null;
let currentAgentAreaHeight = 0;
let currentInputAreaHeight = currentCommandBarMinHeight;
let isDropdownOpen = false;
let baseContentHeight = currentCommandBarMinHeight;
const DROPDOWN_EXTRA_HEIGHT = 80;
let pendingProgrammaticMove: { x: number; y: number } | null = null;
let pendingProgrammaticMoveTimer: NodeJS.Timeout | null = null;

// Default keyboard shortcuts
const DEFAULT_COMMAND_BAR_SHORTCUT = 'CommandOrControl+Enter';
const DEFAULT_RESET_COMMAND_BAR_SHORTCUT = 'CommandOrControl+Shift+Enter';
const DEFAULT_MOVE_PREFIX = 'Command+Alt';
const DEFAULT_TRANSPARENCY_PREFIX = 'Command+Control';

// Movement step in pixels
const MOVE_STEP = 50;
// Opacity step (0-100 scale, will be converted to 0-1)
const OPACITY_STEP = 5;

const THEME_BG_COLORS: Record<string, string> = {
  default:  '#272932',
  comte:    '#121214',
  mercedes: '#46494C',
  pistols:  '#E4DED6',
  carnival: '#001011',
};

function createMainWindow() {
  // Check if user is already logged in to set the correct initial window size
  const db = initDatabase();
  const userRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('userEmail') as { value: string } | undefined;
  const isLoggedIn = !!userRow?.value;

  const themeRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as { value: string } | undefined;
  const savedTheme = themeRow?.value || 'default';
  const backgroundColor = THEME_BG_COLORS[savedTheme] || THEME_BG_COLORS.default;

  const width = isLoggedIn ? 1200 : 400;
  const height = isLoggedIn ? 800 : 500;
  const minWidth = isLoggedIn ? 800 : 400;
  const minHeight = isLoggedIn ? 600 : 500;

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'));
  }

  // Open links in the user's default browser instead of inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow dev server reloads, block everything else and open externally
    if (isDev && url.startsWith('http://localhost:')) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    isMainWindowVisible = false;
    // Hide Dock icon when main window is closed (only command bar remains)
    if (process.platform === 'darwin') {
      app.dock.hide();
    }
  });

  mainWindow.on('show', () => {
    isMainWindowVisible = true;
  });

  mainWindow.on('hide', () => {
    isMainWindowVisible = false;
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-change', true);
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('fullscreen-change', false);
  });

  // Show Dock icon once when main window is created
  if (process.platform === 'darwin') {
    app.dock.show();
  }

  isMainWindowVisible = true;
}

function createCommandBarWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth } = display.workAreaSize;  // Use work area width for accurate centering
  const { height: screenHeight } = display.workAreaSize;

  commandBarWindow = new BrowserWindow({
    width: currentCommandBarWidth,
    height: currentCommandBarMinHeight + COMMAND_BAR_FRAME_HEIGHT,
    x: Math.round((screenWidth - currentCommandBarWidth) / 2),
    y: Math.round(screenHeight - 200),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    show: false,
    hasShadow: false,
    roundedCorners: false,
    // Critical for overlay behavior - don't take focus from other apps
    focusable: true,
    // macOS specific: float above full-screen apps
    fullscreenable: false,
    // Keep it as a panel/overlay type window
    type: 'panel',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  // Set the window level to be above everything (floating panel)
  commandBarWindow.setAlwaysOnTop(true, 'floating', 1);
  // Show on all workspaces/spaces
  commandBarWindow.setVisibleOnAllWorkspaces(true);

  // Make the window non-activating so clicking it doesn't steal focus from other apps
  // This keeps Safari/Chrome selection blue instead of turning grey
  if (windowHelper) {
    const handle = commandBarWindow.getNativeWindowHandle();
    if (handle) {
      const success = windowHelper.makeNonActivating(handle);
      console.log('[Faria] makeNonActivating result:', success);
    }
  }

  if (isDev) {
    commandBarWindow.loadURL('http://localhost:5173/command-bar.html');
  } else {
    commandBarWindow.loadFile(join(__dirname, '../dist/command-bar.html'));
  }

  // Open links in the user's default browser instead of inside the command bar
  commandBarWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  commandBarWindow.webContents.on('will-navigate', (event, url) => {
    if (isDev && url.startsWith('http://localhost:')) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  commandBarWindow.on('blur', () => {
    if (isCommandBarVisible && !agentLoop['isExecutingComputerAction']) {
      commandBarSessionId++;
      commandBarWindow?.webContents.send('command-bar:will-hide');
      commandBarWindow?.hide();
      isCommandBarVisible = false;
      targetAppName = null;
      currentSelectedText = null;
      dividerAnchorY = null;
      bottomAnchorY = null;
      currentAgentAreaHeight = 0;
      currentInputAreaHeight = currentCommandBarMinHeight;
      baseContentHeight = currentCommandBarMinHeight;
      isDropdownOpen = false;
      agentLoop.clearCache();
    }
  });

  commandBarWindow.on('focus', () => {
    // When command bar window regains focus, notify renderer to refresh selection
    if (isCommandBarVisible) {
      commandBarWindow?.webContents.send('command-bar:focus');
    }
  });

  const syncMovedCommandBar = () => {
    if (!commandBarWindow) return;
    if (shouldIgnoreProgrammaticMoveEvent()) return;
    syncCommandBarStateFromWindow({ persist: true });
  };

  commandBarWindow.on('move', syncMovedCommandBar);
  commandBarWindow.on('moved', syncMovedCommandBar);

  commandBarWindow.on('closed', () => {
    clearPendingProgrammaticMove();
    commandBarWindow = null;
  });
}

const VALID_THEMES = ['default', 'comte', 'mercedes', 'pistols', 'carnival'];

// Get current theme data (used by both broadcast and direct requests)
function getThemeData(): { theme: string; font: string } {
  const db = initDatabase();

  const themeRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as { value: string } | undefined;
  const fontRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('selectedFont') as { value: string } | undefined;

  const rawTheme = themeRow?.value || 'default';
  const theme = VALID_THEMES.includes(rawTheme) ? rawTheme : 'default';
  const font = fontRow?.value || "'Bricolage Grotesque', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  return { theme, font };
}

// Broadcast theme changes to all windows
function broadcastThemeChange() {
  const themeData = getThemeData();

  if (mainWindow) {
    mainWindow.webContents.send('settings:theme-change', themeData);
  }
  if (commandBarWindow) {
    commandBarWindow.webContents.send('settings:theme-change', themeData);
  }
}

// Handle opacity change from settings panel
ipcMain.on('settings:opacity-change', (_event, opacity: number) => {
  if (commandBarWindow) {
    commandBarWindow.webContents.send('settings:opacity-change', opacity);
  }
});

function getCommandBarSettings() {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('commandBarPosition') as { value: string } | undefined;
  if (row?.value) {
    try {
      return JSON.parse(row.value);
    } catch {
      return null;
    }
  }
  return null;
}

// Calculate and cache position at startup - call this once
function cacheCommandBarPosition() {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth } = display.workAreaSize;  // Use work area width for accurate centering
  const { height: screenHeight } = display.workAreaSize;

  // Check for saved position
  const savedPosition = getCommandBarSettings();
  if (savedPosition && savedPosition.width === currentCommandBarWidth) {
    cachedCommandBarPosition = {
      x: Math.round(Math.max(0, Math.min(savedPosition.x, screenWidth - currentCommandBarWidth))),
      y: Math.round(Math.max(0, Math.min(savedPosition.y, screenHeight - 200)))
    };
  } else {
    // Default: center horizontally, near bottom of screen
    cachedCommandBarPosition = {
      x: Math.round((screenWidth - currentCommandBarWidth) / 2),
      y: Math.round(screenHeight - 200)
    };
  }
}

function createTray() {
  if (tray) return;

  // Load the Faria logo as a macOS template image (auto-adapts to dark/light menu bar)
  const iconPath = isDev
    ? join(process.cwd(), 'build/trayIconTemplate.png')
    : join(process.resourcesPath!, 'trayIconTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip('Faria');
  tray.setIgnoreDoubleClickEvents(true); // Removes click delay — fires single-click immediately

  tray.on('click', () => {
    // If main window is focused and on the chat tab, focus the chat input instead
    if (mainWindow && mainWindow.isFocused() && mainWindowActiveTab === 'chat') {
      mainWindow.webContents.send('chat:focus');
      return;
    }
    // If command bar is visible, hide it immediately (synchronous path, never blocks)
    if (isCommandBarVisible) {
      toggleCommandBar();
      return;
    }
    // For showing, skip if a toggle is already in progress (async show path)
    if (toggleInProgress) return;
    toggleInProgress = true;
    toggleCommandBar().finally(() => { toggleInProgress = false; });
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Command Bar',
      click: () => {
        if (mainWindow && mainWindow.isFocused() && mainWindowActiveTab === 'chat') {
          mainWindow.webContents.send('chat:focus');
          return;
        }
        if (isCommandBarVisible) {
          toggleCommandBar();
          return;
        }
        if (toggleInProgress) return;
        toggleInProgress = true;
        toggleCommandBar().finally(() => { toggleInProgress = false; });
      },
    },
    {
      label: 'Open App',
      click: () => {
        // Show dock icon so the window is properly visible
        if (process.platform === 'darwin') {
          app.dock.show();
        }
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createMainWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Faria',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.on('right-click', () => {
    tray?.popUpContextMenu(contextMenu);
  });
}

function positionCommandBar() {
  if (!commandBarWindow || !cachedCommandBarPosition) return;
  setCommandBarPositionSafely(cachedCommandBarPosition.x, cachedCommandBarPosition.y);
  syncCommandBarStateFromWindow();
}

function getDropdownOffset() {
  return isDropdownOpen ? DROPDOWN_EXTRA_HEIGHT : 0;
}

function contentHeightToWindowHeight(contentHeight: number) {
  return Math.max(0, Math.round(contentHeight)) + COMMAND_BAR_FRAME_HEIGHT;
}

function windowHeightToContentHeight(windowHeight: number) {
  return Math.max(0, Math.round(windowHeight) - COMMAND_BAR_FRAME_HEIGHT);
}

function syncBottomAnchorToWindow() {
  if (!commandBarWindow) {
    bottomAnchorY = null;
    return;
  }

  const [, y] = commandBarWindow.getPosition();
  const [, height] = commandBarWindow.getSize();
  bottomAnchorY = y + height;
}

function syncDividerAnchorToWindow(agentAreaHeight = currentAgentAreaHeight) {
  if (!commandBarWindow) {
    dividerAnchorY = null;
    return;
  }

  const [, y] = commandBarWindow.getPosition();
  dividerAnchorY = y + getDropdownOffset() + agentAreaHeight;
}

function clearPendingProgrammaticMove() {
  pendingProgrammaticMove = null;
  if (pendingProgrammaticMoveTimer) {
    clearTimeout(pendingProgrammaticMoveTimer);
    pendingProgrammaticMoveTimer = null;
  }
}

function markPendingProgrammaticMove(x: number, y: number) {
  clearPendingProgrammaticMove();
  pendingProgrammaticMove = { x, y };
  pendingProgrammaticMoveTimer = setTimeout(() => {
    clearPendingProgrammaticMove();
  }, 100);
}

function shouldIgnoreProgrammaticMoveEvent() {
  if (!commandBarWindow || !pendingProgrammaticMove) return false;

  const [x, y] = commandBarWindow.getPosition();
  if (x !== pendingProgrammaticMove.x || y !== pendingProgrammaticMove.y) {
    return false;
  }

  clearPendingProgrammaticMove();
  return true;
}

function scheduleCommandBarPositionSave(x: number, y: number, width = currentCommandBarWidth) {
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => {
    const db = initDatabase();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'commandBarPosition',
      JSON.stringify({ x, y, width })
    );
    savePositionTimer = null;
  }, 300);
}

function syncCommandBarStateFromWindow(options?: { persist?: boolean; agentAreaHeight?: number; width?: number }) {
  if (!commandBarWindow) return;

  const [x, y] = commandBarWindow.getPosition();
  cachedCommandBarPosition = { x, y };
  syncBottomAnchorToWindow();
  syncDividerAnchorToWindow(options?.agentAreaHeight ?? currentAgentAreaHeight);

  if (options?.persist) {
    scheduleCommandBarPositionSave(x, y, options.width ?? currentCommandBarWidth);
  }
}

function setCommandBarPositionSafely(x: number, y: number) {
  if (!commandBarWindow) return;
  markPendingProgrammaticMove(x, y);
  commandBarWindow.setPosition(x, y);
}

function setCommandBarBoundsSafely(bounds: Electron.Rectangle) {
  if (!commandBarWindow) return;
  markPendingProgrammaticMove(bounds.x, bounds.y);
  commandBarWindow.setBounds(bounds);
}

function getOrInitDividerAnchorY() {
  if (!commandBarWindow) return null;
  if (dividerAnchorY === null) {
    syncDividerAnchorToWindow();
  }
  return dividerAnchorY;
}

function getOrInitBottomAnchorY() {
  if (!commandBarWindow) return null;
  if (bottomAnchorY === null) {
    syncBottomAnchorToWindow();
  }
  return bottomAnchorY;
}

function applyCommandBarLayout(layout?: CommandBarLayoutPayload) {
  if (!commandBarWindow) return;

  syncCommandBarStateFromWindow({ agentAreaHeight: currentAgentAreaHeight });
  const [width, currentWindowHeight] = commandBarWindow.getSize();
  const [x, currentY] = commandBarWindow.getPosition();
  const maxContentHeight = Math.round(screen.getPrimaryDisplay().workAreaSize.height / 2);
  const previousAgentAreaHeight = currentAgentAreaHeight;
  const previousInputAreaHeight = currentInputAreaHeight;

  if (layout) {
    currentAgentAreaHeight = Math.max(0, Math.round(layout.agentAreaHeight));
    currentInputAreaHeight = Math.max(0, Math.round(layout.inputAreaHeight));
    baseContentHeight = Math.min(
      Math.max(currentAgentAreaHeight + currentInputAreaHeight, currentCommandBarMinHeight),
      maxContentHeight
    );
  } else {
    baseContentHeight = Math.min(
      Math.max(baseContentHeight, currentCommandBarMinHeight),
      maxContentHeight
    );
  }

  const dropdownOffset = getDropdownOffset();
  const newHeight = contentHeightToWindowHeight(baseContentHeight) + dropdownOffset;
  let newY = currentY;
  const agentHeightChanged = currentAgentAreaHeight !== previousAgentAreaHeight;
  const inputHeightChanged = currentInputAreaHeight !== previousInputAreaHeight;

  if (currentAgentAreaHeight > 0) {
    if (inputHeightChanged && !agentHeightChanged) {
      const anchorY = getOrInitBottomAnchorY();
      if (anchorY === null) return;
      newY = Math.round(anchorY - newHeight);
    } else {
      if (previousAgentAreaHeight === 0 || dividerAnchorY === null) {
        syncDividerAnchorToWindow(0);
      }
      const anchorY = getOrInitDividerAnchorY();
      if (anchorY === null) return;
      newY = Math.round(anchorY - currentAgentAreaHeight - dropdownOffset);
    }
  } else {
    const anchorY = getOrInitBottomAnchorY();
    if (anchorY === null) return;
    newY = Math.round(anchorY - newHeight);
    dividerAnchorY = null;
  }

  if (newY !== currentY || newHeight !== currentWindowHeight) {
    setCommandBarBoundsSafely({ x, y: newY, width, height: newHeight });
  }

  syncCommandBarStateFromWindow({ agentAreaHeight: currentAgentAreaHeight });
}

async function getFrontmostApp(): Promise<string | null> {
  try {
    const { stdout } = await execAsync(`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`);
    return stdout.trim();
  } catch (e) {
    console.error('[Faria] Failed to get frontmost app:', e);
    return null;
  }
}

async function toggleCommandBar() {
  // If command bar is visible, hide it immediately (synchronous)
  if (isCommandBarVisible) {
    console.log('[Faria] Hiding command bar (toggle), agent isRunning:', agentLoop['isRunning']);
    // Increment session ID to cancel any pending async operations
    commandBarSessionId++;
    // Send hide event BEFORE hiding so renderer can reset state
    commandBarWindow?.webContents.send('command-bar:will-hide');
    commandBarWindow?.hide();
    isCommandBarVisible = false;
    targetAppName = null;
    currentSelectedText = null;
    dividerAnchorY = null;
    bottomAnchorY = null;
    currentAgentAreaHeight = 0;
    currentInputAreaHeight = currentCommandBarMinHeight;
    baseContentHeight = currentCommandBarMinHeight;
    isDropdownOpen = false;
    agentLoop.clearCache();
    return;
  }

  // Check model settings (synchronous DB read is fast)
  const db = initDatabase();
  const agentModelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('selectedModel') as { value: string } | undefined;
  const agentModel = agentModelRow?.value || 'claude-sonnet-4-6';

  // If model is "none", show error and don't open command bar
  if (agentModel === 'none') {
    // Show error message - we'll send it to the command bar window
    if (!commandBarWindow) {
      createCommandBarWindow();
      positionCommandBar();
    }
    commandBarWindow?.showInactive();
    commandBarWindow?.webContents.focus();
    isCommandBarVisible = true;
    setImmediate(() => {
      if (commandBarWindow && isCommandBarVisible) {
        commandBarWindow.webContents.send('command-bar:error', 'Please choose a model in Settings');
      }
    });
    return;
  }

  // Clear selected text for this session
  currentSelectedText = null;

  // Increment session ID to cancel any stale async operations from previous open/close cycles
  const thisSessionId = ++commandBarSessionId;

  showCommandBar();

  // Clear any lingering error from a previous no-model session (without resetting conversation state)
  commandBarWindow?.webContents.send('command-bar:clear-error');

  // Send detecting state to UI (shows loading indicator)
  setImmediate(() => {
    if (thisSessionId !== commandBarSessionId) return; // Session cancelled
    if (commandBarWindow && isCommandBarVisible) {
      commandBarWindow.webContents.send('command-bar:detecting');
    }
  });

  // Capture frontmost app and selected text in the background
  // This runs AFTER the command bar is visible, so we need to be careful
  // The frontmost app will be captured correctly because we use showInactive()
  getFrontmostApp().then(async (capturedApp) => {
    if (thisSessionId !== commandBarSessionId) return; // Session cancelled

    targetAppName = capturedApp;
    console.log('[Faria] Target app captured:', targetAppName);

    let selectedText: string | null = null;
    try {
      selectedText = await getSelectedText(capturedApp);
    } catch (e) {
      console.error('[Faria] Failed to get selected text:', e);
    }

    // If external detection found nothing, fall back to cached main window selection
    if (!selectedText && mainWindowSelectedText) {
      selectedText = mainWindowSelectedText;
    }

    if (thisSessionId !== commandBarSessionId) return; // Session cancelled

    if (selectedText) {
      console.log('[Faria] Text detected. Length:', selectedText.length);
      currentSelectedText = selectedText;
    } else {
      console.log('[Faria] No text selected');
    }
    // Send ready state to the renderer with character count
    commandBarWindow?.webContents.send('command-bar:ready', {
      hasSelectedText: !!selectedText,
      selectedTextLength: selectedText ? selectedText.length : 0
    });

    // Pre-warm state extraction and tool loading while user types
    agentLoop.warmup(selectedText).catch(e =>
      console.error('[Faria] Warmup failed:', e)
    );
  }).catch(e => {
    if (thisSessionId !== commandBarSessionId) return; // Session cancelled
    console.error('[Faria] Failed to get frontmost app:', e);
    commandBarWindow?.webContents.send('command-bar:ready', { hasSelectedText: false, selectedTextLength: 0 });
  });
}

function showCommandBar() {
  // Check if window exists and webContents is still valid
  // After extended use, the window can get into a bad state where showInactive() silently fails
  if (commandBarWindow && commandBarWindow.webContents.isDestroyed()) {
    console.log('[Faria] Command bar webContents destroyed, recreating window');
    commandBarWindow = null;
  }

  if (!commandBarWindow) {
    createCommandBarWindow();
    positionCommandBar();
  }

  // Hide Dock icon before showing command bar to prevent visual app switching
  // This makes Faria behave like an accessory app (similar to Maccy)
  if (process.platform === 'darwin' && !isMainWindowVisible) {
    app.dock.hide();
  }

  // Use showInactive() to avoid activating the app and causing window switching
  // This is similar to NSPanel's nonactivatingPanel behavior in Maccy
  commandBarWindow?.showInactive();

  // Verify visibility and use native forceShow if needed
  // showInactive() can fail silently on macOS with panel-type windows after extended use
  if (commandBarWindow) {
    const handle = commandBarWindow.getNativeWindowHandle();

    // Use native helper if available (more reliable than Electron's isVisible)
    if (windowHelper && handle) {
      if (!windowHelper.isVisible(handle)) {
        console.log('[Faria] showInactive() failed, using native forceShow');
        windowHelper.forceShow(handle);
      }
    } else if (!commandBarWindow.isVisible()) {
      // Fallback for when native addon isn't available
      console.log('[Faria] showInactive() failed, trying show() as fallback');
      commandBarWindow.show();

      // If still not visible, recreate the window
      if (!commandBarWindow.isVisible()) {
        console.log('[Faria] Window still not visible, recreating');
        commandBarWindow.destroy();
        commandBarWindow = null;
        createCommandBarWindow();
        positionCommandBar();
        commandBarWindow!.show();
      }
    }
  }

  isCommandBarVisible = true;

  // Use native stealKeyFocus to make the window receive keyboard input
  // without activating the Electron app (keeps Safari selection blue)
  if (windowHelper && commandBarWindow && typeof windowHelper.stealKeyFocus === 'function') {
    const handle = commandBarWindow.getNativeWindowHandle();
    if (handle) {
      windowHelper.stealKeyFocus(handle);
    }
  }

  // Send focus event in next tick to not block
  setImmediate(() => {
    if (commandBarWindow && isCommandBarVisible) {
      commandBarWindow.webContents.send('command-bar:focus');
      // Mode is sent after detection completes in toggleCommandBar()
    }
  });
}

// Reset the command bar to its default position and clear all state
async function resetCommandBar() {
  console.log('[Faria] resetCommandBar called, cancelling agent');
  // Cancel any running agent and clear conversation history
  agentLoop.cancel();
  agentLoop.clearHistory();
  agentLoop.clearCache();

  // Increment session ID to cancel any pending async operations
  commandBarSessionId++;

  // Reset cached position to default (center, near bottom)
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth } = display.workAreaSize;  // Use work area width for accurate centering
  const { height: screenHeight } = display.workAreaSize;
  cachedCommandBarPosition = {
    x: Math.round((screenWidth - currentCommandBarWidth) / 2),
    y: Math.round(screenHeight - 200)
  };

  // Clear any saved position in the database
  const db = initDatabase();
  db.prepare('DELETE FROM settings WHERE key = ?').run('commandBarPosition');

  // Clear context
  targetAppName = null;
  currentSelectedText = null;
  dividerAnchorY = null;
  bottomAnchorY = null;
  currentAgentAreaHeight = 0;
  currentInputAreaHeight = currentCommandBarMinHeight;
  baseContentHeight = currentCommandBarMinHeight;
  isDropdownOpen = false;

  // If command bar doesn't exist, create it
  if (!commandBarWindow || commandBarWindow.webContents.isDestroyed()) {
    commandBarWindow = null;
    createCommandBarWindow();
  }

  // Reset window size and position
  commandBarWindow?.setSize(currentCommandBarWidth, contentHeightToWindowHeight(currentCommandBarMinHeight));
  positionCommandBar();

  // Send reset event to renderer to clear all state
  commandBarWindow?.webContents.send('command-bar:reset');

  // Show the command bar
  showCommandBar();

  // Send ready state after reset
  commandBarWindow?.webContents.send('command-bar:ready', {
    hasSelectedText: false,
    selectedTextLength: 0
  });
}

// Current opacity value (0-100 scale)
let currentOpacity = 70;

// Debounce timers for saving settings (allows smooth key repeat without DB thrashing)
let savePositionTimer: NodeJS.Timeout | null = null;
let saveOpacityTimer: NodeJS.Timeout | null = null;

// Timer to detect when held key is released (no more repeat events)
let repeatStopTimer: NodeJS.Timeout | null = null;
const REPEAT_STOP_DELAY = 200; // ms after last shortcut fire to consider key released

// Schedule cleanup after key release - resets timer each time shortcut fires
// When key is held, macOS sends repeated key events; when released, events stop
// and this timer fires to perform any cleanup (like debounced saves)
function scheduleRepeatStop() {
  if (repeatStopTimer) {
    clearTimeout(repeatStopTimer);
  }
  repeatStopTimer = setTimeout(() => {
    repeatStopTimer = null;
    // Any cleanup needed after key release can go here
  }, REPEAT_STOP_DELAY);
}

// Move command bar in a direction
function moveCommandBar(direction: 'up' | 'down' | 'left' | 'right') {
  if (!commandBarWindow) return;

  const [x, y] = commandBarWindow.getPosition();
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = display.workAreaSize;
  const [winWidth, winHeight] = commandBarWindow.getSize();

  let newX = x;
  let newY = y;

  switch (direction) {
    case 'up':
      newY = Math.max(0, y - MOVE_STEP);
      break;
    case 'down':
      newY = Math.min(screenHeight - winHeight, y + MOVE_STEP);
      break;
    case 'left':
      newX = Math.max(0, x - MOVE_STEP);
      break;
    case 'right':
      newX = Math.min(screenWidth - winWidth, x + MOVE_STEP);
      break;
  }

  setCommandBarPositionSafely(newX, newY);
  syncCommandBarStateFromWindow();
  scheduleCommandBarPositionSave(newX, newY);
}

// Change command bar transparency
function changeTransparency(increase: boolean) {
  if (increase) {
    currentOpacity = Math.min(100, currentOpacity + OPACITY_STEP);
  } else {
    currentOpacity = Math.max(10, currentOpacity - OPACITY_STEP);
  }

  // Notify command bar window of opacity change immediately (smooth visual feedback)
  if (commandBarWindow) {
    commandBarWindow.webContents.send('settings:opacity-change', currentOpacity / 100);
  }

  // Debounce save to database (saves 300ms after last change, allows smooth key repeat)
  if (saveOpacityTimer) clearTimeout(saveOpacityTimer);
  saveOpacityTimer = setTimeout(() => {
    const db = initDatabase();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'commandBarOpacity',
      (currentOpacity / 100).toString()
    );
    saveOpacityTimer = null;
  }, 300);
}

// Load saved command bar size on startup
function loadSavedSize() {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('commandBarSize') as { value: string } | undefined;
  if (row?.value && row.value in COMMAND_BAR_SIZES) {
    currentSizeMode = row.value as CommandBarSizeMode;
    const config = COMMAND_BAR_SIZES[currentSizeMode];
    currentCommandBarWidth = config.width;
    currentCommandBarMinHeight = config.minHeight;
    currentInputAreaHeight = currentCommandBarMinHeight;
    baseContentHeight = currentCommandBarMinHeight;
  }
}

// Apply a new command bar size (resize window, broadcast to renderer)
function applyCommandBarSize(sizeStr: string) {
  if (!(sizeStr in COMMAND_BAR_SIZES)) return;

  const newSize = sizeStr as CommandBarSizeMode;
  const config = COMMAND_BAR_SIZES[newSize];

  currentSizeMode = newSize;
  currentCommandBarWidth = config.width;
  currentCommandBarMinHeight = config.minHeight;

  if (!commandBarWindow) return;

  const [oldWidth, currentHeight] = commandBarWindow.getSize();
  const [oldX, y] = commandBarWindow.getPosition();

  // Re-center horizontally by shifting x by half the width delta
  const widthDelta = config.width - oldWidth;
  const newX = Math.max(0, oldX - Math.round(widthDelta / 2));

  // Clamp height to at least the new minimum
  const newHeight = Math.max(windowHeightToContentHeight(currentHeight), config.minHeight);
  baseContentHeight = newHeight;
  currentInputAreaHeight = Math.max(currentInputAreaHeight, config.minHeight);

  setCommandBarBoundsSafely({ x: newX, y, width: config.width, height: contentHeightToWindowHeight(newHeight) });
  syncCommandBarStateFromWindow({ width: config.width });
  scheduleCommandBarPositionSave(newX, y, config.width);

  // Broadcast to command bar renderer
  commandBarWindow.webContents.send('settings:size-change', newSize);
}

// Load saved opacity on startup
async function loadSavedOpacity() {
  const db = initDatabase();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('commandBarOpacity') as { value: string } | undefined;
  if (row?.value) {
    currentOpacity = Math.round(parseFloat(row.value) * 100);
  }
}

function registerGlobalShortcuts() {
  // Unregister all existing shortcuts first
  globalShortcut.unregisterAll();

  // Load shortcuts from settings
  const db = initDatabase();
  const commandBarShortcutRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('commandBarShortcut') as { value: string } | undefined;
  const commandBarShortcut = commandBarShortcutRow?.value || DEFAULT_COMMAND_BAR_SHORTCUT;

  const resetShortcutRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('resetCommandBarShortcut') as { value: string } | undefined;
  const resetShortcut = resetShortcutRow?.value || DEFAULT_RESET_COMMAND_BAR_SHORTCUT;

  const movePrefixRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('moveShortcutPrefix') as { value: string } | undefined;
  const movePrefix = movePrefixRow?.value || DEFAULT_MOVE_PREFIX;

  const transparencyPrefixRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('transparencyShortcutPrefix') as { value: string } | undefined;
  const transparencyPrefix = transparencyPrefixRow?.value || DEFAULT_TRANSPARENCY_PREFIX;

  console.log('[Faria] Registering shortcut:', commandBarShortcut);
  console.log('[Faria] Registering reset shortcut:', resetShortcut);
  console.log('[Faria] Registering move prefix:', movePrefix);
  console.log('[Faria] Registering transparency prefix:', transparencyPrefix);

  // Register command bar toggle shortcut with lock to prevent queued toggles
  const ret = globalShortcut.register(commandBarShortcut, () => {
    // If main window is focused and on the chat tab, focus the chat input instead
    if (mainWindow && mainWindow.isFocused() && mainWindowActiveTab === 'chat') {
      mainWindow.webContents.send('chat:focus');
      return;
    }
    // Hide path is synchronous — always allow it immediately
    if (isCommandBarVisible) {
      toggleCommandBar();
      return;
    }
    // Show path is async — skip if already in progress
    if (toggleInProgress) return;
    toggleInProgress = true;
    toggleCommandBar().finally(() => { toggleInProgress = false; });
  });

  if (!ret) {
    console.error('[Faria] Failed to register global shortcut for toggle:', commandBarShortcut);
  }

  // Register reset command bar shortcut
  const retReset = globalShortcut.register(resetShortcut, () => {
    // If main window is focused and on the chat tab, clear the chat input instead
    if (mainWindow && mainWindow.isFocused() && mainWindowActiveTab === 'chat') {
      mainWindow.webContents.send('chat:clear');
      return;
    }
    resetCommandBar();
  });

  if (!retReset) {
    console.error('[Faria] Failed to register global shortcut for reset:', resetShortcut);
  }

  // Register move shortcuts (prefix + arrow keys)
  // macOS sends repeated key events when holding a key (based on System Preferences > Keyboard settings)
  // globalShortcut receives these repeats, so we just execute the action on each fire
  // and use scheduleRepeatStop to detect when the key is released (no more events)
  const moveDirections: Array<{ key: string; direction: 'up' | 'down' | 'left' | 'right' }> = [
    { key: 'Up', direction: 'up' },
    { key: 'Down', direction: 'down' },
    { key: 'Left', direction: 'left' },
    { key: 'Right', direction: 'right' },
  ];

  for (const { key, direction } of moveDirections) {
    const shortcut = `${movePrefix}+${key}`;
    const retMove = globalShortcut.register(shortcut, () => {
      // Only allow movement when command bar is visible
      if (!isCommandBarVisible) return;
      // Execute the move
      moveCommandBar(direction);
      // Reset stop timer - if key is held, this will be called again before timer fires
      scheduleRepeatStop();
    });
    if (!retMove) {
      console.error('[Faria] Failed to register move shortcut:', shortcut);
    }
  }

  // Register transparency shortcuts (prefix + up/down)
  const retTransUp = globalShortcut.register(`${transparencyPrefix}+Up`, () => {
    // Only allow opacity change when command bar is visible
    if (!isCommandBarVisible) return;
    changeTransparency(true);
    scheduleRepeatStop();
  });
  if (!retTransUp) {
    console.error('[Faria] Failed to register transparency up shortcut');
  }

  const retTransDown = globalShortcut.register(`${transparencyPrefix}+Down`, () => {
    // Only allow opacity change when command bar is visible
    if (!isCommandBarVisible) return;
    changeTransparency(false);
    scheduleRepeatStop();
  });
  if (!retTransDown) {
    console.error('[Faria] Failed to register transparency down shortcut');
  }
}

function setupIPC() {
  // Agent-related IPC
  ipcMain.handle('agent:submit', async (_event, query: string, previousContext?: { query: string; response: string }) => {
    try {
      console.log('[Faria] Agent submit with target app:', targetAppName, 'selectedText:', currentSelectedText ? `${currentSelectedText.length} chars` : 'none', 'previousContext:', previousContext ? 'yes' : 'no');
      const result = await agentLoop.run(query, targetAppName, currentSelectedText, previousContext);
      // After agent finishes, re-focus the command bar so the next
      // click-away properly triggers a blur event to dismiss it
      if (isCommandBarVisible && commandBarWindow && !commandBarWindow.isFocused()) {
        commandBarWindow.focus();
      }
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('agent:cancel', async (_event, source?: string) => {
    console.log('[Faria] agent:cancel IPC received from renderer, source:', source || 'unknown');
    agentLoop.cancel();
    return { success: true };
  });

  // State extraction IPC
  ipcMain.handle('state:extract', async () => {
    try {
      const state = await stateExtractor.extractState();
      return { success: true, state };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Auth IPC
  ipcMain.handle('auth:google-signin', async () => {
    try {
      const { googleSignIn } = await import('./services/google-auth');
      const result = await googleSignIn();
      if (result.success && result.email && result.uid) {
        const db = initDatabase();
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('userEmail', result.email);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('userUid', result.uid);
        db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('authProvider', 'google');
        if (result.displayName) {
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('userDisplayName', result.displayName);
        }
        if (result.photoUrl) {
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('userPhotoUrl', result.photoUrl);
        }
        // Store Firebase tokens for proxy auth
        if (result.idToken && result.refreshToken) {
          const { setTokens } = await import('./services/auth-token');
          setTokens(result.idToken, result.refreshToken);
        }
      }
      return result;
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('auth:get-user', async () => {
    const db = initDatabase();
    const email = db.prepare('SELECT value FROM settings WHERE key = ?').get('userEmail') as { value: string } | undefined;
    const uid = db.prepare('SELECT value FROM settings WHERE key = ?').get('userUid') as { value: string } | undefined;
    if (email?.value && uid?.value) {
      const displayNameRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('userDisplayName') as { value: string } | undefined;
      let displayName = displayNameRow?.value || null;
      // Fallback: check legacy firstName/lastName keys
      if (!displayName) {
        const fn = db.prepare('SELECT value FROM settings WHERE key = ?').get('firstName') as { value: string } | undefined;
        const ln = db.prepare('SELECT value FROM settings WHERE key = ?').get('lastName') as { value: string } | undefined;
        const combined = `${fn?.value || ''} ${ln?.value || ''}`.trim();
        if (combined) {
          displayName = combined;
          // Migrate to canonical key
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('userDisplayName', combined);
        }
      }
      const photoUrl = db.prepare('SELECT value FROM settings WHERE key = ?').get('userPhotoUrl') as { value: string } | undefined;
      const provider = db.prepare('SELECT value FROM settings WHERE key = ?').get('authProvider') as { value: string } | undefined;
      return {
        email: email.value,
        uid: uid.value,
        displayName,
        photoUrl: photoUrl?.value || null,
        provider: provider?.value || null,
      };
    }
    return null;
  });

  ipcMain.handle('auth:set-token', async (_event, idToken: string, refreshToken: string) => {
    const { setTokens } = await import('./services/auth-token');
    setTokens(idToken, refreshToken);
    return { success: true };
  });

  ipcMain.handle('auth:sign-out', async () => {
    const db = initDatabase();
    db.prepare('DELETE FROM settings WHERE key IN (?, ?, ?, ?, ?)').run(
      'userEmail', 'userUid', 'authProvider', 'userDisplayName', 'userPhotoUrl'
    );
    const { clearTokens } = await import('./services/auth-token');
    clearTokens();
    return { success: true };
  });

  // Permissions IPC — check and request macOS Accessibility & Screen Recording
  ipcMain.handle('permissions:check', async () => {
    const { systemPreferences, desktopCapturer } = await import('electron');
    const accessibility = systemPreferences.isTrustedAccessibilityClient(false);

    // getMediaAccessStatus alone is not enough: after reinstalling the app with a
    // different code-signing identity, TCC still shows 'granted' in System Settings
    // but actual captures are silently rejected. Verify by exercising the real API.
    let screenRecording = false;
    const mediaStatus = systemPreferences.getMediaAccessStatus('screen');
    if (mediaStatus === 'granted') {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 },
        });
        screenRecording = sources.length > 0;
      } catch {
        screenRecording = false;
      }
    }

    return { accessibility, screenRecording };
  });

  ipcMain.handle('permissions:request-accessibility', async () => {
    const { systemPreferences } = await import('electron');
    // Passing true opens the System Preferences pane and prompts the user
    systemPreferences.isTrustedAccessibilityClient(true);
    return { success: true };
  });

  ipcMain.handle('permissions:request-screen-recording', async () => {
    const { systemPreferences, desktopCapturer, shell } = await import('electron');
    const status = systemPreferences.getMediaAccessStatus('screen');

    if (status === 'not-determined') {
      // Calling getSources() triggers the native TCC dialog and automatically
      // registers the app in System Settings > Privacy > Screen Recording.
      // Without this call the app never appears in the list and users have to
      // click the + button to add it manually.
      try {
        await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 },
        });
      } catch {
        // Ignore — we'll check the result below
      }
      const newStatus = systemPreferences.getMediaAccessStatus('screen');
      if (newStatus !== 'granted') {
        // User denied the dialog — open System Settings so they can reconsider
        await shell.openExternal(
          'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
        );
      }
    } else {
      // 'denied', 'restricted', or 'granted' (but potentially stale after reinstall).
      // Open System Settings so the user can enable or toggle the permission off/on
      // to repair a broken TCC entry.
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
    }

    return { success: true };
  });

  // Profile context menu (native macOS menu)
  ipcMain.handle('menu:profile', async () => {
    const { Menu } = await import('electron');
    return new Promise<string | null>((resolve) => {
      const menu = Menu.buildFromTemplate([
        {
          label: 'Sign Out',
          click: () => resolve('sign-out'),
        },
      ]);
      menu.popup({ callback: () => resolve(null) });
    });
  });

  // Window management — hide, resize, re-center, then show for a clean transition
  ipcMain.handle('window:setSize', async (_event, width: number, height: number) => {
    if (mainWindow) {
      mainWindow.hide();
      mainWindow.setMinimumSize(800, 600);
      mainWindow.setSize(width, height, false);
      mainWindow.center();
      // Small delay so the renderer can paint the new content before showing
      await new Promise(r => setTimeout(r, 80));
      mainWindow.show();
    }
  });

  // Settings IPC
  ipcMain.handle('settings:get', async (_event, key: string) => {
    const db = initDatabase();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  });

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    const db = initDatabase();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    
    // Broadcast theme changes to all windows (including command bar)
    const themeKeys = ['theme', 'selectedFont'];
    if (themeKeys.includes(key)) {
      broadcastThemeChange();
    }

    // Apply command bar size change
    if (key === 'commandBarSize') {
      applyCommandBarSize(value);
    }

    return { success: true };
  });

  // Get current theme data (including colors)
  ipcMain.handle('settings:getThemeData', () => {
    return getThemeData();
  });

  // Get current command bar size mode
  ipcMain.handle('settings:getSizeMode', () => {
    return currentSizeMode;
  });

  // Get default prompt
  ipcMain.handle('settings:getDefaultPrompt', async () => {
    const { AGENT_SYSTEM_PROMPT } = await import('./static/prompts/agent');
    return AGENT_SYSTEM_PROMPT;
  });

  // Shortcuts IPC
  ipcMain.handle('shortcuts:reregister', async () => {
    try {
      registerGlobalShortcuts();
      return { success: true };
    } catch (error) {
      console.error('[Faria] Failed to re-register shortcuts:', error);
      return { success: false, error: String(error) };
    }
  });

  // History IPC
  ipcMain.handle('history:get', async () => {
    const db = initDatabase();
    // Convert SQLite datetime to Unix timestamp in milliseconds for proper timezone handling
    const rows = db.prepare(`
      SELECT 
        id,
        query,
        response,
        tools_used,
        agent_type,
        actions,
        context_text,
        strftime('%s', created_at) * 1000 as created_at
      FROM history 
      ORDER BY created_at DESC
    `).all();
    
    // Convert created_at from string to number and parse JSON fields
    return rows.map((row: any) => ({
      ...row,
      created_at: parseInt(row.created_at, 10),
      tools_used: row.tools_used ? JSON.parse(row.tools_used) : null,
      actions: row.actions ? JSON.parse(row.actions) : null,
      agent_type: row.agent_type || 'regular'
    }));
  });

  ipcMain.handle('history:add', async (_event, query: string, response: string) => {
    const db = initDatabase();
    db.prepare('INSERT INTO history (query, response, agent_type) VALUES (?, ?, ?)').run(query, response, 'regular');
    return { success: true };
  });

  // Integrations IPC - Composio connection management
  ipcMain.handle('integrations:list', async () => {
    return composioService.getConnections();
  });

  ipcMain.handle('integrations:delete', async (_event, connectionId: string) => {
    return composioService.deleteConnection(connectionId);
  });

  ipcMain.handle('integrations:apps', async () => {
    return composioService.getAvailableApps();
  });

  ipcMain.handle('integrations:connect', async (_event, appName: string) => {
    return composioService.initiateConnection(appName);
  });

  // Shell - Open external URLs in default browser
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // Window control IPC
  // Cache text selection reported by the main window renderer
  ipcMain.on('selection:report', (_event, text: string) => {
    mainWindowSelectedText = text && text.length > 0 ? text : null;
  });

  // Track which tab is active in the main window
  ipcMain.on('main:active-tab', (_event: Electron.IpcMainEvent, tab: string) => {
    mainWindowActiveTab = tab;
  });

  ipcMain.on('command-bar:hide', () => {
    if (commandBarWindow && isCommandBarVisible) {
      // Send hide event BEFORE hiding so renderer can reset state
      commandBarWindow.webContents.send('command-bar:will-hide');
      commandBarWindow.hide();
      isCommandBarVisible = false;
      currentSelectedText = null;
      dividerAnchorY = null;
      bottomAnchorY = null;
      currentAgentAreaHeight = 0;
      currentInputAreaHeight = currentCommandBarMinHeight;
      baseContentHeight = currentCommandBarMinHeight;
      isDropdownOpen = false;
    }
  });

  // Refresh selected text while command bar is open
  ipcMain.handle('command-bar:refresh-selection', async () => {
    if (!isCommandBarVisible || !targetAppName) {
      return { hasSelectedText: false, selectedTextLength: 0 };
    }

    try {
      const selectedText = await getSelectedText(targetAppName);
      if (selectedText) {
        console.log('[Faria] Selection refreshed. Length:', selectedText.length);
        currentSelectedText = selectedText;
        return { hasSelectedText: true, selectedTextLength: selectedText.length };
      } else {
        console.log('[Faria] No text selected on refresh');
        currentSelectedText = null;
        return { hasSelectedText: false, selectedTextLength: 0 };
      }
    } catch (e) {
      console.error('[Faria] Failed to refresh selected text:', e);
      return { hasSelectedText: false, selectedTextLength: 0 };
    }
  });

  ipcMain.on('command-bar:resize', (_event, layout: CommandBarLayoutPayload) => {
    applyCommandBarLayout(layout);
  });

  // Dropdown visibility - expand window upward to make room
  ipcMain.on('command-bar:dropdown-visible', (_event, visible: boolean) => {
    if (!commandBarWindow) return;

    if (visible && !isDropdownOpen) {
      isDropdownOpen = true;
    } else if (!visible && isDropdownOpen) {
      isDropdownOpen = false;
    } else {
      return;
    }

    applyCommandBarLayout();
  });

  // Forward agent status updates to command bar
  ipcMain.on('agent:status', (_event, status: string) => {
    commandBarWindow?.webContents.send('agent:status', status);
  });

  ipcMain.on('agent:response', (_event, response: string) => {
    commandBarWindow?.webContents.send('agent:response', response);
  });
}

async function initializeServices() {
  // Initialize database
  const db = initDatabase();

  // Seed API keys from environment variables on first launch
  const envGoogleKey = process.env.GOOGLE_API_KEY;
  if (envGoogleKey) {
    const existingGoogleKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('googleKey') as { value: string } | undefined;
    if (!existingGoogleKey?.value) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('googleKey', envGoogleKey);
      console.log('[Faria] Seeded Google API key from environment');
    }
  }

  const envAnthropicKey = process.env.ANTHROPIC_API_KEY;
  if (envAnthropicKey) {
    const existingAnthropicKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('anthropicKey') as { value: string } | undefined;
    if (!existingAnthropicKey?.value) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('anthropicKey', envAnthropicKey);
      console.log('[Faria] Seeded Anthropic API key from environment');
    }
  }

  // Set default model if none is set
  const existingModel = db.prepare('SELECT value FROM settings WHERE key = ?').get('selectedModel') as { value: string } | undefined;
  if (!existingModel?.value || existingModel.value === 'none') {
    const googleKeyAvailable = db.prepare('SELECT value FROM settings WHERE key = ?').get('googleKey') as { value: string } | undefined;
    const anthropicKeyAvailable = db.prepare('SELECT value FROM settings WHERE key = ?').get('anthropicKey') as { value: string } | undefined;
    if (googleKeyAvailable?.value) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('selectedModel', 'gemini-3-flash-preview');
      console.log('[Faria] Set default model to Gemini 3 Flash');
    } else if (anthropicKeyAvailable?.value) {
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('selectedModel', 'claude-3-5-sonnet-20241022');
      console.log('[Faria] Set default model to Claude 3.5 Sonnet');
    }
  }

  // Initialize embedding model in background (don't block startup)
  initEmbeddings().catch((err: unknown) => {
    console.error('[Memory] Failed to init embeddings:', err);
  });

  // Migrate memories from JSON to markdown (v2) in background
  migrateToMarkdownMemory().catch((err: Error) => {
    console.error('[Memory] Failed to migrate to v2:', err);
  });

  // Initialize Composio for external integrations (Gmail, GitHub, Slack, etc.)
  composioService = new ComposioService();
  composioService.initialize().catch(err => {
    console.warn('[Composio] Init deferred (user may not be signed in yet):', err.message);
  });

  // Initialize services
  stateExtractor = new StateExtractor();
  toolExecutor = new ToolExecutor(stateExtractor);
  agentLoop = new AgentLoop(stateExtractor, toolExecutor, composioService);

  // Auto-reopen command bar when agent needs user attention
  // Skip if the user is on the chat tab — the chat UI handles responses/approvals inline
  agentLoop.setOnNeedsAttention(() => {
    if (mainWindow && mainWindow.isFocused() && mainWindowActiveTab === 'chat') {
      return;
    }
    if (!isCommandBarVisible) {
      console.log('[Faria] Agent needs attention, auto-showing command bar');
      showCommandBar();
    }
  });
}

app.whenReady().then(async () => {
  await initializeServices();
  // Recover Firebase auth tokens from previous session
  const { loadTokensFromDb } = await import('./services/auth-token');
  loadTokensFromDb();
  createMainWindow();
  loadSavedSize(); // Load saved size before position caching and window creation
  cacheCommandBarPosition(); // Cache position before creating window
  loadSavedOpacity(); // Load saved opacity before creating window
  createCommandBarWindow();
  positionCommandBar(); // Position once at startup
  createTray(); // Menu bar icon for quick access
  registerGlobalShortcuts();
  setupIPC();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
