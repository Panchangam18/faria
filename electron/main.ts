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
let inlineBarWindow: BrowserWindow | null = null;
let isCommandBarVisible = false;
let isInlineBarVisible = false;
let targetAppName: string | null = null; // The app that was focused when command bar was invoked
let currentContextText: string | null = null; // Text around cursor for inline mode

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

function createInlineBarWindow() {
  inlineBarWindow = new BrowserWindow({
    width: 400,
    height: 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    show: false,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    hasShadow: true,
    focusable: true,
    fullscreenable: false,
    type: 'panel',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  
  inlineBarWindow.setAlwaysOnTop(true, 'floating', 1);
  inlineBarWindow.setVisibleOnAllWorkspaces(true);

  if (isDev) {
    inlineBarWindow.loadURL('http://localhost:5173/inline-command-bar.html');
  } else {
    inlineBarWindow.loadFile(join(__dirname, '../inline-command-bar.html'));
  }

  inlineBarWindow.on('closed', () => {
    inlineBarWindow = null;
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

async function positionCommandBar() {
  if (!commandBarWindow) return;

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  
  // Use saved position from settings
  const savedPosition = getCommandBarSettings();
  if (savedPosition) {
    const x = Math.max(0, Math.min(savedPosition.x, screenWidth - savedPosition.width));
    const y = Math.max(0, Math.min(savedPosition.y, screenHeight - 200));
    commandBarWindow.setPosition(Math.round(x), Math.round(y));
    commandBarWindow.setSize(savedPosition.width, commandBarWindow.getSize()[1]);
    return;
  }

  // Default: center horizontally, near bottom of screen
  const defaultWidth = 600;
  const x = Math.round((screenWidth - defaultWidth) / 2);
  const y = Math.round(screenHeight - 300);
  commandBarWindow.setPosition(x, y);
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
  // If either bar is visible, hide both
  if (isCommandBarVisible || isInlineBarVisible) {
    commandBarWindow?.hide();
    inlineBarWindow?.hide();
    isCommandBarVisible = false;
    isInlineBarVisible = false;
    targetAppName = null;
    currentContextText = null;
    return;
  }

  // Capture target app BEFORE anything else
  targetAppName = await getFrontmostApp();
  console.log('[Faria] Target app captured:', targetAppName);
  
  // Check if user has text selected - if so, show inline bar
  const selectedText = await getSelectedText(targetAppName);
  
  if (selectedText) {
    console.log('[Faria] Text selected, showing inline bar. Length:', selectedText.length);
    currentContextText = selectedText;
    await showInlineBar();
  } else {
    console.log('[Faria] No text selected, showing regular command bar');
    await showRegularCommandBar();
  }
}

async function showRegularCommandBar() {
  if (!commandBarWindow) {
    createCommandBarWindow();
  }

  await positionCommandBar();
  commandBarWindow?.showInactive();
  
  setTimeout(() => {
    if (commandBarWindow && isCommandBarVisible) {
      commandBarWindow.focus();
      commandBarWindow.webContents.send('command-bar:focus');
    }
  }, 50);
  
  isCommandBarVisible = true;
}

async function showInlineBar() {
  if (!inlineBarWindow) {
    createInlineBarWindow();
  }

  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
  const mousePos = screen.getCursorScreenPoint();
  const barWidth = 400;
  const barHeight = 40;
  
  // Position near the mouse cursor
  let x = Math.max(0, Math.min(mousePos.x - barWidth / 2, screenWidth - barWidth));
  let y: number;
  
  // If cursor is in upper half, show below; otherwise show above
  if (mousePos.y < screenHeight / 2) {
    y = mousePos.y + 30; // Below cursor
  } else {
    y = mousePos.y - barHeight - 10; // Above cursor
  }
  
  y = Math.max(0, Math.min(y, screenHeight - barHeight));
  
  // Show the inline bar and focus it
  inlineBarWindow?.setPosition(Math.round(x), Math.round(y));
  inlineBarWindow?.showInactive();
  isInlineBarVisible = true;
  
  // Focus and send context after a brief delay for window to be ready
  setTimeout(() => {
    if (inlineBarWindow && isInlineBarVisible) {
      inlineBarWindow.focus();
      inlineBarWindow.webContents.send('inline-bar:focus');
      
      // Send the selected text as context
      if (currentContextText) {
        inlineBarWindow.webContents.send('inline-bar:context', currentContextText);
      }
    }
  }, 50);
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

  // Inline bar IPC handlers
  ipcMain.on('inline-bar:hide', () => {
    if (inlineBarWindow && isInlineBarVisible) {
      inlineBarWindow.hide();
      isInlineBarVisible = false;
      currentContextText = null;
    }
  });

  ipcMain.handle('inline-bar:submit', async (_event, query: string, contextText: string) => {
    try {
      console.log('[Faria] Inline submit:', query, 'context length:', contextText?.length || 0);
      
      const inlineAgent = getInlineAgent();
      
      // Set up status callback
      inlineAgent.setStatusCallback((status) => {
        inlineBarWindow?.webContents.send('inline-bar:status', status);
      });
      
      const result = await inlineAgent.run(query, contextText || null, targetAppName);
      
      if (result.type === 'edits') {
        inlineBarWindow?.webContents.send('inline-bar:edit-applied');
      }
      
      inlineBarWindow?.webContents.send('inline-bar:response', result.content);
      return { success: true, result: result.content };
    } catch (error) {
      const errorMsg = String(error);
      inlineBarWindow?.webContents.send('inline-bar:response', errorMsg);
      return { success: false, error: errorMsg };
    }
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
  createInlineBarWindow();
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

