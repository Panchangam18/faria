import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import { join } from 'path';
import { initDatabase } from './db/sqlite';
import { StateExtractor } from './services/state-extractor';
import { AgentLoop } from './agent/loop';
import { ToolExecutor } from './agent/tools';
import { getInlineAgent } from './inline';
import { getSelectedText } from './services/text-extraction';
import { exec } from 'child_process';
import { promisify } from 'util';
import { initEmbeddings, migrateFromSQLite } from './services/memory';

const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;
let commandBarWindow: BrowserWindow | null = null;
let isCommandBarVisible = false;
let targetAppName: string | null = null; // The app that was focused when command bar was invoked
let currentContextText: string | null = null; // Text around cursor for inline mode
let currentMode: 'agent' | 'inline' = 'agent';
let cachedCommandBarPosition: { x: number; y: number } | null = null; // Cached position for instant toggle
let commandBarSessionId = 0; // Incremented on each open to cancel stale async operations

// Services
let stateExtractor: StateExtractor;
let agentLoop: AgentLoop;
let toolExecutor: ToolExecutor;

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
const DEFAULT_COMMAND_BAR_SHORTCUT = 'CommandOrControl+/';
const DEFAULT_AGENT_SWITCH_SHORTCUT = 'CommandOrControl+Shift+/';

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
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
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
    vibrancy: 'under-window',
    visualEffectState: 'active',
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
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
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
    // Increment session ID to cancel any pending async operations
    commandBarSessionId++;
    // Send hide event BEFORE hiding so renderer can reset state synchronously
    commandBarWindow?.webContents.send('command-bar:will-hide');
    commandBarWindow?.hide();
    isCommandBarVisible = false;
    targetAppName = null;
    currentContextText = null;
    currentMode = 'agent';
    return;
  }

  // Check model settings (synchronous DB read is fast)
  const db = initDatabase();
  const agentModelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('selectedModel') as { value: string } | undefined;
  const inlineModelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('selectedInlineModel') as { value: string } | undefined;
  const agentModel = agentModelRow?.value || 'claude-sonnet-4-20250514';
  const inlineModel = inlineModelRow?.value || 'claude-sonnet-4-20250514';

  // If both models are "none", show error and don't open command bar
  if (agentModel === 'none' && inlineModel === 'none') {
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

  // Show command bar IMMEDIATELY - no waiting for async operations
  // Start in 'detecting' state, will resolve to agent/inline once text detection completes
  currentContextText = null;

  // Increment session ID to cancel any stale async operations from previous open/close cycles
  const thisSessionId = ++commandBarSessionId;

  showCommandBar();

  // Send model availability right away, mode will be sent after detection
  setImmediate(() => {
    if (thisSessionId !== commandBarSessionId) return; // Session cancelled
    if (commandBarWindow && isCommandBarVisible) {
      commandBarWindow.webContents.send('command-bar:model-availability', {
        agentAvailable: agentModel !== 'none',
        inlineAvailable: inlineModel !== 'none'
      });
    }
  });

  // Capture frontmost app and selected text in the background
  // This runs AFTER the command bar is visible, so we need to be careful
  // The frontmost app will be captured correctly because we use showInactive()
  getFrontmostApp().then(capturedApp => {
    if (thisSessionId !== commandBarSessionId) return; // Session cancelled

    targetAppName = capturedApp;
    console.log('[Faria] Target app captured:', targetAppName);

    // Only try to get selected text if inline mode is available
    if (inlineModel === 'none') {
      console.log('[Faria] Inline model is None, defaulting to agent mode');
      currentMode = 'agent';
      commandBarWindow?.webContents.send('command-bar:mode-change', currentMode, undefined);
      return;
    }

    getSelectedText(capturedApp).then(selectedText => {
      if (thisSessionId !== commandBarSessionId) return; // Session cancelled

      if (selectedText) {
        console.log('[Faria] Text detected, using inline mode. Length:', selectedText.length);
        currentContextText = selectedText;
        currentMode = 'inline';
      } else {
        console.log('[Faria] No text selected, using agent mode');
        currentMode = agentModel !== 'none' ? 'agent' : 'inline';
      }
      // Send the resolved mode to the renderer
      commandBarWindow?.webContents.send('command-bar:mode-change', currentMode, currentContextText || undefined);
    }).catch(e => {
      if (thisSessionId !== commandBarSessionId) return; // Session cancelled
      console.error('[Faria] Failed to get selected text:', e);
      // Default to agent mode on error
      currentMode = agentModel !== 'none' ? 'agent' : 'inline';
      commandBarWindow?.webContents.send('command-bar:mode-change', currentMode, undefined);
    });
  }).catch(e => {
    if (thisSessionId !== commandBarSessionId) return; // Session cancelled
    console.error('[Faria] Failed to get frontmost app:', e);
    // Default to agent mode on error
    currentMode = agentModel !== 'none' ? 'agent' : 'inline';
    commandBarWindow?.webContents.send('command-bar:mode-change', currentMode, undefined);
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

function registerGlobalShortcuts() {
  // Unregister all existing shortcuts first
  globalShortcut.unregisterAll();

  // Load shortcuts from settings
  const db = initDatabase();
  const commandBarShortcutRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('commandBarShortcut') as { value: string } | undefined;
  const agentSwitchShortcutRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('agentSwitchShortcut') as { value: string } | undefined;

  const commandBarShortcut = commandBarShortcutRow?.value || DEFAULT_COMMAND_BAR_SHORTCUT;
  const agentSwitchShortcut = agentSwitchShortcutRow?.value || DEFAULT_AGENT_SWITCH_SHORTCUT;

  console.log('[Faria] Registering shortcuts:', { commandBarShortcut, agentSwitchShortcut });

  // Register command bar toggle shortcut
  const ret = globalShortcut.register(commandBarShortcut, () => {
    toggleCommandBar();
  });

  if (!ret) {
    console.error('[Faria] Failed to register global shortcut for toggle:', commandBarShortcut);
  }

  // Register agent switch shortcut (only when command bar is visible)
  const ret2 = globalShortcut.register(agentSwitchShortcut, () => {
    if (isCommandBarVisible && commandBarWindow) {
      // Toggle between agent and inline mode
      const newMode = currentMode === 'agent' ? 'inline' : 'agent';

      // Check if the target mode's model is available
      const db = initDatabase();
      const modelKey = newMode === 'agent' ? 'selectedModel' : 'selectedInlineModel';
      const modelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(modelKey) as { value: string } | undefined;
      const model = modelRow?.value || 'claude-sonnet-4-20250514';

      if (model === 'none') {
        console.log('[Faria] Cannot switch to', newMode, '- model is None');
        commandBarWindow.webContents.send('command-bar:error', `Cannot switch to ${newMode} mode - model is set to None in Settings`);
        return;
      }

      currentMode = newMode;
      console.log('[Faria] Mode switched via hotkey to:', newMode);
      commandBarWindow.webContents.send('command-bar:mode-change', newMode, currentContextText || undefined);
    }
  });

  if (!ret2) {
    console.error('[Faria] Failed to register global shortcut for agent switch:', agentSwitchShortcut);
  }
}

function setupIPC() {
  // Agent-related IPC
  ipcMain.handle('agent:submit', async (_event, query: string) => {
    try {
      console.log('[Faria] Agent submit with target app:', targetAppName);
      const result = await agentLoop.run(query, targetAppName);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle('agent:cancel', async () => {
    // Cancel both agent and inline agent
    agentLoop.cancel();
    getInlineAgent().cancel();
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

  // Get default prompts
  ipcMain.handle('settings:getDefaultPrompt', async (_event, promptType: 'inline' | 'agent') => {
    if (promptType === 'inline') {
      const { INLINE_SYSTEM_PROMPT } = await import('./static/prompts/inline');
      return INLINE_SYSTEM_PROMPT;
    } else {
      const { AGENT_SYSTEM_PROMPT } = await import('./static/prompts/agent');
      return AGENT_SYSTEM_PROMPT;
    }
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

  // Custom tools IPC
  ipcMain.handle('tools:list', async () => {
    const db = initDatabase();
    return db.prepare('SELECT * FROM custom_tools ORDER BY usage_count DESC').all();
  });

  ipcMain.handle('tools:get', async (_event, id: string) => {
    const db = initDatabase();
    return db.prepare('SELECT * FROM custom_tools WHERE id = ?').get(id);
  });

  ipcMain.handle('tools:create', async (_event, tool: {
    id: string;
    name: string;
    description: string;
    parameters: string;
    code: string;
  }) => {
    const db = initDatabase();
    db.prepare(`
      INSERT INTO custom_tools (id, name, description, parameters, code, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(tool.id, tool.name, tool.description, tool.parameters, tool.code);
    return { success: true };
  });

  ipcMain.handle('tools:delete', async (_event, id: string) => {
    const db = initDatabase();
    db.prepare('DELETE FROM custom_tools WHERE id = ?').run(id);
    return { success: true };
  });

  // Window control IPC
  ipcMain.on('command-bar:hide', () => {
    if (commandBarWindow && isCommandBarVisible) {
      // Send hide event BEFORE hiding so renderer can reset state synchronously
      commandBarWindow.webContents.send('command-bar:will-hide');
      commandBarWindow.hide();
      isCommandBarVisible = false;
      currentMode = 'agent';
      currentContextText = null;
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

  // Mode switching IPC
  ipcMain.on('command-bar:set-mode', (_event, mode: 'agent' | 'inline') => {
    // Check if the target mode's model is available
    const db = initDatabase();
    const modelKey = mode === 'agent' ? 'selectedModel' : 'selectedInlineModel';
    const modelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get(modelKey) as { value: string } | undefined;
    const model = modelRow?.value || 'claude-sonnet-4-20250514';
    
    if (model === 'none') {
      console.log('[Faria] Cannot switch to', mode, '- model is None');
      if (commandBarWindow) {
        commandBarWindow.webContents.send('command-bar:error', `Cannot switch to ${mode} mode - model is set to None in Settings`);
      }
      return;
    }
    
    currentMode = mode;
    console.log('[Faria] Mode switched to:', mode);
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

  // Inline submission IPC (for unified command bar)
  ipcMain.handle('command-bar:submit-inline', async (_event, query: string, contextText: string) => {
    try {
      console.log('[Faria] Inline submit:', query, 'context length:', contextText?.length || 0);
      
      const inlineAgent = getInlineAgent();
      
      // Set up status callback
      inlineAgent.setStatusCallback((status) => {
        commandBarWindow?.webContents.send('command-bar:inline-status', status);
      });
      
      const result = await inlineAgent.run(query, contextText || currentContextText || null, targetAppName);
      
      if (result.type === 'edits') {
        commandBarWindow?.webContents.send('command-bar:edit-applied');
      }
      
      commandBarWindow?.webContents.send('command-bar:inline-response', result.content);
      return { success: true, result: result.content };
    } catch (error) {
      const errorMsg = String(error);
      commandBarWindow?.webContents.send('command-bar:inline-response', errorMsg);
      return { success: false, error: errorMsg };
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

  // Initialize services
  stateExtractor = new StateExtractor();
  toolExecutor = new ToolExecutor(stateExtractor);
  agentLoop = new AgentLoop(stateExtractor, toolExecutor);
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
