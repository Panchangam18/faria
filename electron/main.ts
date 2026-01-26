import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron';
import { join } from 'path';
import { initDatabase } from './db/sqlite';
import { StateExtractor } from './services/state-extractor';
import { AgentLoop } from './agent/loop';
import { ToolExecutor } from './agent/tools';
import { ComposioService } from './services/composio';
import { getSelectedText } from './services/text-extraction';
import { exec } from 'child_process';
import { promisify } from 'util';
import { initEmbeddings, migrateFromSQLite } from './services/memory';

const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;
let commandBarWindow: BrowserWindow | null = null;
let isCommandBarVisible = false;
let targetAppName: string | null = null; // The app that was focused when command bar was invoked
let currentSelectedText: string | null = null; // User-selected text when command bar was invoked
let cachedCommandBarPosition: { x: number; y: number } | null = null; // Cached position for instant toggle
let commandBarSessionId = 0; // Incremented on each open to cancel stale async operations
let lastToggleTime = 0; // Timestamp of last toggle to throttle rapid keypresses

// Services
let stateExtractor: StateExtractor;
let agentLoop: AgentLoop;
let toolExecutor: ToolExecutor;
let composioService: ComposioService;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Native window helper for reliable window visibility on macOS
// Falls back gracefully if addon fails to load
let windowHelper: { forceShow: (handle: Buffer) => boolean; isVisible: (handle: Buffer) => boolean } | null = null;
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

// Default command bar dimensions
const DEFAULT_COMMAND_BAR_WIDTH = 400;
const DEFAULT_COMMAND_BAR_HEIGHT = 67; // Single line: 46 (base) + 21 (one line)

// Default keyboard shortcuts
const DEFAULT_COMMAND_BAR_SHORTCUT = 'CommandOrControl+Enter';
const DEFAULT_RESET_COMMAND_BAR_SHORTCUT = 'CommandOrControl+Shift+Enter';

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#272932',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../index.html'));
  }

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
    // Show Dock icon when main window is visible
    if (process.platform === 'darwin') {
      app.dock.show();
    }
  });

  mainWindow.on('hide', () => {
    isMainWindowVisible = false;
    // Hide Dock icon when main window is hidden
    if (process.platform === 'darwin') {
      app.dock.hide();
    }
  });

  isMainWindowVisible = true;
}

function createCommandBarWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth } = display.bounds;  // Use full display width for perfect centering
  const { height: screenHeight } = display.workAreaSize;

  commandBarWindow = new BrowserWindow({
    width: DEFAULT_COMMAND_BAR_WIDTH,
    height: DEFAULT_COMMAND_BAR_HEIGHT,
    x: Math.round((screenWidth - DEFAULT_COMMAND_BAR_WIDTH) / 2),
    y: Math.round(screenHeight - 300),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    show: false,
    hasShadow: false,
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

  if (isDev) {
    commandBarWindow.loadURL('http://localhost:5173/command-bar.html');
  } else {
    commandBarWindow.loadFile(join(__dirname, '../command-bar.html'));
  }

  commandBarWindow.on('blur', () => {
    // Don't hide on blur - only hide via hotkey
  });

  commandBarWindow.on('closed', () => {
    commandBarWindow = null;
  });
}

// Broadcast theme changes to all windows
async function broadcastThemeChange() {
  const db = initDatabase();
  
  // Get current theme settings
  const themeRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('theme') as { value: string } | undefined;
  const fontRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('selectedFont') as { value: string } | undefined;
  const customPalettesRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('customPalettes') as { value: string } | undefined;
  const activeCustomPaletteRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('activeCustomPalette') as { value: string } | undefined;
  
  const theme = themeRow?.value || 'default';
  const font = fontRow?.value || "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  
  let customColors: { background: string; text: string; accent: string } | undefined;
  
  if (theme === 'custom' && customPalettesRow?.value && activeCustomPaletteRow?.value) {
    try {
      const palettes = JSON.parse(customPalettesRow.value);
      const activePalette = palettes.find((p: any) => p.name === activeCustomPaletteRow.value);
      if (activePalette) {
        customColors = {
          background: activePalette.background,
          text: activePalette.text,
          accent: activePalette.accent
        };
      }
    } catch (e) {
      console.error('[Faria] Error parsing custom palettes:', e);
    }
  }
  
  const themeData = { theme, font, customColors };
  
  // Send to all windows
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
  const { width: screenWidth } = display.bounds;  // Use full display width for perfect centering
  const { height: screenHeight } = display.workAreaSize;

  // Check for saved position
  const savedPosition = getCommandBarSettings();
  if (savedPosition && savedPosition.width === DEFAULT_COMMAND_BAR_WIDTH) {
    cachedCommandBarPosition = {
      x: Math.round(Math.max(0, Math.min(savedPosition.x, screenWidth - DEFAULT_COMMAND_BAR_WIDTH))),
      y: Math.round(Math.max(0, Math.min(savedPosition.y, screenHeight - 200)))
    };
  } else {
    // Default: center horizontally, near bottom of screen
    cachedCommandBarPosition = {
      x: Math.round((screenWidth - DEFAULT_COMMAND_BAR_WIDTH) / 2),
      y: Math.round(screenHeight - 300)
    };
  }
}

function positionCommandBar() {
  if (!commandBarWindow || !cachedCommandBarPosition) return;
  commandBarWindow.setPosition(cachedCommandBarPosition.x, cachedCommandBarPosition.y);
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
    // Send hide event BEFORE hiding so renderer can reset state synchronously
    commandBarWindow?.webContents.send('command-bar:will-hide');
    commandBarWindow?.hide();
    isCommandBarVisible = false;
    targetAppName = null;
    currentSelectedText = null;
    return;
  }

  // Check model settings (synchronous DB read is fast)
  const db = initDatabase();
  const agentModelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('selectedModel') as { value: string } | undefined;
  const agentModel = agentModelRow?.value || 'claude-sonnet-4-20250514';

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
        // Hide after showing error
        setTimeout(() => {
          if (commandBarWindow && isCommandBarVisible) {
            commandBarWindow.hide();
            isCommandBarVisible = false;
          }
        }, 3000);
      }
    });
    return;
  }

  // Clear selected text for this session
  currentSelectedText = null;

  // Increment session ID to cancel any stale async operations from previous open/close cycles
  const thisSessionId = ++commandBarSessionId;

  showCommandBar();

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
  getFrontmostApp().then(capturedApp => {
    if (thisSessionId !== commandBarSessionId) return; // Session cancelled

    targetAppName = capturedApp;
    console.log('[Faria] Target app captured:', targetAppName);

    getSelectedText(capturedApp).then(selectedText => {
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
    }).catch(e => {
      if (thisSessionId !== commandBarSessionId) return; // Session cancelled
      console.error('[Faria] Failed to get selected text:', e);
      commandBarWindow?.webContents.send('command-bar:ready', { hasSelectedText: false, selectedTextLength: 0 });
    });
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

  // Focus the webContents to receive keyboard input without fully activating the app
  // This allows typing in the command bar while Chrome stays visually "in front"
  commandBarWindow?.webContents.focus();

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
  // Cancel any running agent
  agentLoop.cancel();

  // Increment session ID to cancel any pending async operations
  commandBarSessionId++;

  // Reset cached position to default (center, near bottom)
  const display = screen.getPrimaryDisplay();
  const { width: screenWidth } = display.bounds;  // Use full display width for perfect centering
  const { height: screenHeight } = display.workAreaSize;
  cachedCommandBarPosition = {
    x: Math.round((screenWidth - DEFAULT_COMMAND_BAR_WIDTH) / 2),
    y: Math.round(screenHeight - 300)
  };

  // Clear any saved position in the database
  const db = initDatabase();
  db.prepare('DELETE FROM settings WHERE key = ?').run('commandBarPosition');

  // Clear context
  targetAppName = null;
  currentSelectedText = null;

  // If command bar doesn't exist, create it
  if (!commandBarWindow || commandBarWindow.webContents.isDestroyed()) {
    commandBarWindow = null;
    createCommandBarWindow();
  }

  // Reset window size and position
  commandBarWindow?.setSize(DEFAULT_COMMAND_BAR_WIDTH, DEFAULT_COMMAND_BAR_HEIGHT);
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

function registerGlobalShortcuts() {
  // Unregister all existing shortcuts first
  globalShortcut.unregisterAll();

  // Load shortcuts from settings
  const db = initDatabase();
  const commandBarShortcutRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('commandBarShortcut') as { value: string } | undefined;
  const commandBarShortcut = commandBarShortcutRow?.value || DEFAULT_COMMAND_BAR_SHORTCUT;

  const resetShortcutRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('resetCommandBarShortcut') as { value: string } | undefined;
  const resetShortcut = resetShortcutRow?.value || DEFAULT_RESET_COMMAND_BAR_SHORTCUT;

  console.log('[Faria] Registering shortcut:', commandBarShortcut);
  console.log('[Faria] Registering reset shortcut:', resetShortcut);

  // Register command bar toggle shortcut with throttling to prevent queued toggles
  const ret = globalShortcut.register(commandBarShortcut, () => {
    const now = Date.now();
    if (now - lastToggleTime < 100) return; // Ignore keypresses faster than 100ms apart
    lastToggleTime = now;
    toggleCommandBar();
  });

  if (!ret) {
    console.error('[Faria] Failed to register global shortcut for toggle:', commandBarShortcut);
  }

  // Register reset command bar shortcut
  const retReset = globalShortcut.register(resetShortcut, () => {
    resetCommandBar();
  });

  if (!retReset) {
    console.error('[Faria] Failed to register global shortcut for reset:', resetShortcut);
  }
}

function setupIPC() {
  // Agent-related IPC
  ipcMain.handle('agent:submit', async (_event, query: string) => {
    try {
      console.log('[Faria] Agent submit with target app:', targetAppName, 'selectedText:', currentSelectedText ? `${currentSelectedText.length} chars` : 'none');
      const result = await agentLoop.run(query, targetAppName, currentSelectedText);
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
    const themeKeys = ['theme', 'activeCustomPalette', 'customPalettes', 'selectedFont'];
    if (themeKeys.includes(key)) {
      broadcastThemeChange();
    }
    
    return { success: true };
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
      LIMIT 100
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
  ipcMain.on('command-bar:hide', () => {
    if (commandBarWindow && isCommandBarVisible) {
      // Send hide event BEFORE hiding so renderer can reset state synchronously
      commandBarWindow.webContents.send('command-bar:will-hide');
      commandBarWindow.hide();
      isCommandBarVisible = false;
      currentSelectedText = null;
    }
  });

  // Track dropdown state for resize coordination
  let isDropdownOpen = false;
  let baseContentHeight = DEFAULT_COMMAND_BAR_HEIGHT;
  const DROPDOWN_EXTRA_HEIGHT = 80;

  ipcMain.on('command-bar:resize', (_event, height: number) => {
    if (commandBarWindow) {
      const [width] = commandBarWindow.getSize();
      // Min: ~60 (single line with minimal padding), Max: ~350 (5 lines + response area)
      const clampedHeight = Math.min(Math.max(height, 60), 350);
      baseContentHeight = clampedHeight;
      
      if (isDropdownOpen) {
        // When dropdown is open, add extra height and keep window expanded upward
        const [x, y] = commandBarWindow.getPosition();
        const currentHeight = commandBarWindow.getSize()[1];
        const newTotalHeight = clampedHeight + DROPDOWN_EXTRA_HEIGHT;
        const heightDiff = newTotalHeight - currentHeight;
        
        commandBarWindow.setBounds({
          x,
          y: y - heightDiff,
          width,
          height: newTotalHeight
        });
      } else {
        commandBarWindow.setSize(width, clampedHeight);
      }
    }
  });

  // Dropdown visibility - expand window upward to make room
  ipcMain.on('command-bar:dropdown-visible', (_event, visible: boolean) => {
    if (!commandBarWindow) return;
    
    const [width, height] = commandBarWindow.getSize();
    const [x, y] = commandBarWindow.getPosition();
    
    if (visible && !isDropdownOpen) {
      isDropdownOpen = true;
      // Expand window upward: move Y up and increase height
      commandBarWindow.setBounds({
        x,
        y: y - DROPDOWN_EXTRA_HEIGHT,
        width,
        height: height + DROPDOWN_EXTRA_HEIGHT
      });
    } else if (!visible && isDropdownOpen) {
      isDropdownOpen = false;
      // Restore to base content height
      commandBarWindow.setBounds({
        x,
        y: y + DROPDOWN_EXTRA_HEIGHT,
        width,
        height: baseContentHeight
      });
    }
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
  initDatabase();

  // Initialize embedding model in background (don't block startup)
  initEmbeddings().catch(err => {
    console.error('[Memory] Failed to init embeddings:', err);
  });

  // Migrate from SQLite in background (don't block startup)
  migrateFromSQLite().catch(err => {
    console.error('[Memory] Failed to migrate:', err);
  });

  // Initialize Composio for external integrations (Gmail, GitHub, Slack, etc.)
  composioService = new ComposioService();
  await composioService.initialize();

  // Initialize services
  stateExtractor = new StateExtractor();
  toolExecutor = new ToolExecutor(stateExtractor);
  agentLoop = new AgentLoop(stateExtractor, toolExecutor, composioService);
}

app.whenReady().then(async () => {
  await initializeServices();
  createMainWindow();
  cacheCommandBarPosition(); // Cache position before creating window
  createCommandBarWindow();
  positionCommandBar(); // Position once at startup
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
