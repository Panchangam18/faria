import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import { join } from 'path';
import { initDatabase } from './db/sqlite';
import { StateExtractor } from './services/state-extractor';
import { AppRegistry } from './services/app-registry';
import { AgentLoop } from './agent/loop';
import { ToolExecutor } from './agent/tools';
import { getInlineAgent } from './agent/inline-loop';
import { getSelectedText } from './services/text-extraction';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;
let commandBarWindow: BrowserWindow | null = null;
let isCommandBarVisible = false;
let targetAppName: string | null = null; // The app that was focused when command bar was invoked
let currentContextText: string | null = null; // Text around cursor for inline mode
let currentMode: 'agent' | 'inline' = 'agent';
let cachedCommandBarPosition: { x: number; y: number } | null = null; // Cached position for instant toggle

// Services
let stateExtractor: StateExtractor;
let appRegistry: AppRegistry;
let agentLoop: AgentLoop;
let toolExecutor: ToolExecutor;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Default command bar dimensions
const DEFAULT_COMMAND_BAR_WIDTH = 400;
const DEFAULT_COMMAND_BAR_HEIGHT = 83; // Single line: 80 (base) + 23 (one line)

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
  });
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
    hasShadow: true,
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

function toggleCommandBar() {
  // If command bar is visible, hide it immediately (synchronous)
  if (isCommandBarVisible) {
    commandBarWindow?.hide();
    isCommandBarVisible = false;
    targetAppName = null;
    currentContextText = null;
    currentMode = 'agent';
    return;
  }

  // Show window immediately with default mode (synchronous)
  currentMode = 'agent';
  currentContextText = null;
  showCommandBar();
  
  // Capture target app and selected text in the background, then update mode
  (async () => {
    // Only proceed if window is still visible
    if (!isCommandBarVisible || !commandBarWindow) return;
    
    targetAppName = await getFrontmostApp();
    console.log('[Faria] Target app captured:', targetAppName);
    
    // Check if window is still visible before updating
    if (!isCommandBarVisible || !commandBarWindow) return;
    
    // Check if user has text selected - if so, switch to inline mode
    const selectedText = await getSelectedText(targetAppName);
    
    // Final check before updating
    if (!isCommandBarVisible || !commandBarWindow) return;
    
    if (selectedText) {
      console.log('[Faria] Text selected, switching to inline mode. Length:', selectedText.length);
      currentContextText = selectedText;
      currentMode = 'inline';
      // Update the renderer with the new mode and context
      commandBarWindow.webContents.send('command-bar:mode-change', currentMode, selectedText);
    } else {
      console.log('[Faria] No text selected, staying in agent mode');
    }
  })();
}

function showCommandBar() {
  if (!commandBarWindow) {
    createCommandBarWindow();
    positionCommandBar();
  }

  // Just show - position is already set
  commandBarWindow?.show();
  isCommandBarVisible = true;
  
  // Send focus event in next tick to not block
  setImmediate(() => {
    if (commandBarWindow && isCommandBarVisible) {
      commandBarWindow.webContents.send('command-bar:focus');
      commandBarWindow.webContents.send('command-bar:mode-change', currentMode, currentContextText || undefined);
    }
  });
}

function registerGlobalShortcut() {
  const ret = globalShortcut.register('CommandOrControl+Shift+Space', () => {
    toggleCommandBar();
  });

  if (!ret) {
    console.error('Failed to register global shortcut');
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
    return { success: true };
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
        strftime('%s', created_at) * 1000 as created_at
      FROM history 
      ORDER BY created_at DESC 
      LIMIT 100
    `).all();
    
    // Convert created_at from string to number
    return rows.map((row: any) => ({
      ...row,
      created_at: parseInt(row.created_at, 10)
    }));
  });

  ipcMain.handle('history:add', async (_event, query: string, response: string) => {
    const db = initDatabase();
    db.prepare('INSERT INTO history (query, response) VALUES (?, ?)').run(query, response);
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
      commandBarWindow.hide();
      isCommandBarVisible = false;
      currentMode = 'agent';
      currentContextText = null;
    }
  });

  ipcMain.on('command-bar:resize', (_event, height: number) => {
    if (commandBarWindow) {
      const [width] = commandBarWindow.getSize();
      // Min: ~100 (single line), Max: ~295 (5 lines + response area)
      commandBarWindow.setSize(width, Math.min(Math.max(height, 100), 300));
    }
  });

  // Mode switching IPC
  ipcMain.on('command-bar:set-mode', (_event, mode: 'agent' | 'inline') => {
    currentMode = mode;
    console.log('[Faria] Mode switched to:', mode);
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

  // Initialize services
  appRegistry = new AppRegistry();
  stateExtractor = new StateExtractor(appRegistry);
  toolExecutor = new ToolExecutor(appRegistry, stateExtractor);
  agentLoop = new AgentLoop(stateExtractor, toolExecutor);
}

app.whenReady().then(async () => {
  await initializeServices();
  createMainWindow();
  cacheCommandBarPosition(); // Cache position before creating window
  createCommandBarWindow();
  positionCommandBar(); // Position once at startup
  registerGlobalShortcut();
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
