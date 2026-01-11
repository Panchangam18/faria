import { exec } from 'child_process';
import { promisify } from 'util';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, chmodSync } from 'fs';

const execAsync = promisify(exec);

// Path to bundled cliclick binary
function getCliClickPath(): string {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    return join(process.cwd(), 'resources', 'cliclick');
  }
  
  return join(process.resourcesPath, 'resources', 'cliclick');
}

// Ensure cliclick is executable
function ensureExecutable(): void {
  const cliclickPath = getCliClickPath();
  if (existsSync(cliclickPath)) {
    try {
      chmodSync(cliclickPath, '755');
    } catch {
      // Ignore errors on chmod
    }
  }
}

ensureExecutable();

/**
 * Execute a cliclick command
 */
async function runCliClick(args: string): Promise<string> {
  const cliclickPath = getCliClickPath();
  
  if (!existsSync(cliclickPath)) {
    // Fall back to system-installed cliclick or homebrew
    try {
      const { stdout } = await execAsync(`cliclick ${args}`);
      return stdout.trim();
    } catch {
      throw new Error(
        'cliclick not found. Please install it via: brew install cliclick'
      );
    }
  }
  
  try {
    const { stdout } = await execAsync(`"${cliclickPath}" ${args}`, {
      timeout: 10000,
    });
    return stdout.trim();
  } catch (error) {
    const err = error as Error;
    throw new Error(`cliclick execution failed: ${err.message}`);
  }
}

/**
 * Type text using keyboard simulation
 */
export async function sendKeystrokes(text: string): Promise<void> {
  // Escape special characters for cliclick
  const escaped = text
    .replace(/:/g, '\\:')
    .replace(/\n/g, '')  // Handle newlines separately
    .replace(/\t/g, '');  // Handle tabs separately
  
  // cliclick uses 't:' for typing text
  await runCliClick(`t:"${escaped}"`);
}

/**
 * Send a keyboard shortcut
 */
export async function sendHotkey(modifiers: string[], key: string): Promise<void> {
  // Map modifier names to cliclick modifier characters
  const modMap: Record<string, string> = {
    cmd: 'cmd',
    command: 'cmd',
    ctrl: 'ctrl',
    control: 'ctrl',
    alt: 'alt',
    option: 'alt',
    shift: 'shift',
  };
  
  // Map special key names
  const keyMap: Record<string, string> = {
    enter: 'return',
    return: 'return',
    escape: 'esc',
    esc: 'esc',
    tab: 'tab',
    space: 'space',
    delete: 'delete',
    backspace: 'delete',
    up: 'arrow-up',
    down: 'arrow-down',
    left: 'arrow-left',
    right: 'arrow-right',
    pageup: 'page-up',
    pagedown: 'page-down',
    home: 'home',
    end: 'end',
    f1: 'f1', f2: 'f2', f3: 'f3', f4: 'f4', f5: 'f5', f6: 'f6',
    f7: 'f7', f8: 'f8', f9: 'f9', f10: 'f10', f11: 'f11', f12: 'f12',
  };
  
  const mappedMods = modifiers.map(m => modMap[m.toLowerCase()] || m.toLowerCase());
  const mappedKey = keyMap[key.toLowerCase()] || key.toLowerCase();
  
  // Build the key press command
  // Format: kp:modifier,modifier,key
  if (mappedMods.length > 0) {
    const modString = mappedMods.join(',');
    await runCliClick(`kp:"${modString},${mappedKey}"`);
  } else {
    await runCliClick(`kp:"${mappedKey}"`);
  }
}

/**
 * Click at screen coordinates
 */
export async function click(x: number, y: number): Promise<void> {
  await runCliClick(`c:${Math.round(x)},${Math.round(y)}`);
}

/**
 * Double-click at screen coordinates
 */
export async function doubleClick(x: number, y: number): Promise<void> {
  await runCliClick(`dc:${Math.round(x)},${Math.round(y)}`);
}

/**
 * Right-click at screen coordinates
 */
export async function rightClick(x: number, y: number): Promise<void> {
  await runCliClick(`rc:${Math.round(x)},${Math.round(y)}`);
}

/**
 * Move mouse to coordinates
 */
export async function moveMouse(x: number, y: number): Promise<void> {
  await runCliClick(`m:${Math.round(x)},${Math.round(y)}`);
}

/**
 * Click and drag from one point to another
 */
export async function drag(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): Promise<void> {
  await runCliClick(
    `dd:${Math.round(startX)},${Math.round(startY)} du:${Math.round(endX)},${Math.round(endY)}`
  );
}

/**
 * Get current mouse position
 */
export async function getMousePosition(): Promise<{ x: number; y: number }> {
  const result = await runCliClick('p');
  const match = result.match(/(\d+),(\d+)/);
  if (match) {
    return { x: parseInt(match[1], 10), y: parseInt(match[2], 10) };
  }
  throw new Error('Failed to get mouse position');
}

/**
 * Scroll in a direction
 */
export async function scroll(
  direction: 'up' | 'down' | 'left' | 'right',
  amount: number = 1
): Promise<void> {
  // Use keyboard shortcuts for scrolling as cliclick doesn't have native scroll
  const keyMap: Record<string, [string[], string]> = {
    up: [[], 'page-up'],
    down: [[], 'page-down'],
    left: [['cmd'], 'arrow-left'],
    right: [['cmd'], 'arrow-right'],
  };
  
  const [mods, key] = keyMap[direction];
  
  for (let i = 0; i < amount; i++) {
    await sendHotkey(mods, key);
    // Small delay between scrolls
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

/**
 * Sleep helper
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

