import { app, BrowserWindow, globalShortcut, ipcMain, screen } from 'electron';
import { join } from 'path';
import { initDatabase } from './db/sqlite';
import { StateExtractor } from './services/state-extractor';
import { AppRegistry } from './services/app-registry';
import { AgentLoop } from './agent/loop';
import { ToolExecutor } from './agent/tools';
import { getTextCursorPosition } from './services/accessibility';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

let mainWindow: BrowserWindow | null = null;
let commandBarWindow: BrowserWindow | null = null;
let isCommandBarVisible = false;
let targetAppName: string | null = null; // The app that was focused when command bar was invoked

// Services
let stateExtractor: StateExtractor;
let appRegistry: AppRegistry;
let agentLoop: AgentLoop;
let toolExecutor: ToolExecutor;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

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
    width: 600,
    height: 103, // Single line: 80 (base) + 23 (one line)
    x: Math.round((screenWidth - 600) / 2),
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
    // Show on all workspaces/spaces
    visibleOnAllWorkspaces: true,
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

async function positionCommandBar() {
  if (!commandBarWindow) return;

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  // Try to get text cursor position first
  try {
    const textCursorPos = await getTextCursorPosition();
    if (textCursorPos) {
      const x = Math.max(0, Math.min(textCursorPos.x - 300, screenWidth - 600));
      const y = Math.max(0, Math.min(textCursorPos.y + 20, screenHeight - 200));
      commandBarWindow.setPosition(Math.round(x), Math.round(y));
      return;
    }
  } catch (e) {
    // Fall through to mouse position
  }

  // Fall back to mouse cursor position
  const mousePos = screen.getCursorScreenPoint();
  const x = Math.max(0, Math.min(mousePos.x - 300, screenWidth - 600));
  const y = Math.max(0, Math.min(mousePos.y + 20, screenHeight - 200));
  commandBarWindow.setPosition(Math.round(x), Math.round(y));
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
  if (!commandBarWindow) {
    createCommandBarWindow();
  }

  if (isCommandBarVisible) {
    commandBarWindow?.hide();
    isCommandBarVisible = false;
    targetAppName = null;
  } else {
    // CRITICAL: Capture the target app BEFORE showing the command bar
    targetAppName = await getFrontmostApp();
    console.log('[Faria] Target app captured:', targetAppName);
    
    await positionCommandBar();
    // Use showInactive to avoid stealing focus from the current app
    // Then focus only when needed for typing
    commandBarWindow?.showInactive();
    
    // Small delay then focus the window for input
    // This helps maintain the overlay feel while still allowing typing
    setTimeout(() => {
      if (commandBarWindow && isCommandBarVisible) {
        commandBarWindow.focus();
        commandBarWindow.webContents.send('command-bar:focus');
      }
    }, 50);
    
    isCommandBarVisible = true;
  }
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
    }
  });

  ipcMain.on('command-bar:resize', (_event, height: number) => {
    if (commandBarWindow) {
      const [width] = commandBarWindow.getSize();
      // Min: ~100 (single line), Max: ~410 (10 lines + response area)
      commandBarWindow.setSize(width, Math.min(Math.max(height, 100), 450));
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
  createCommandBarWindow();
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

