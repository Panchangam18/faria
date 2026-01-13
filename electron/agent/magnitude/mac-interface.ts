/**
 * HybridMacInterface - Magnitude DesktopInterface implementation for macOS
 * Uses cliclick for mouse/keyboard actions and AppleScript for app control
 */

import { DesktopInterface } from 'magnitude-core';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { app } from 'electron';
import { existsSync, chmodSync } from 'fs';

const execAsync = promisify(exec);

// Get path to bundled cliclick binary
function getCliClickPath(): string {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  
  if (isDev) {
    return path.join(process.cwd(), 'resources', 'cliclick');
  }
  
  return path.join(process.resourcesPath, 'resources', 'cliclick');
}

// Run cliclick command
async function runCliClick(args: string): Promise<string> {
  const cliclickPath = getCliClickPath();
  
  if (!existsSync(cliclickPath)) {
    // Fall back to system-installed cliclick
    try {
      const { stdout } = await execAsync(`cliclick ${args}`);
      return stdout.trim();
    } catch {
      throw new Error('cliclick not found. Please install it via: brew install cliclick');
    }
  }
  
  try {
    chmodSync(cliclickPath, '755');
  } catch {
    // Ignore
  }
  
  const { stdout } = await execAsync(`"${cliclickPath}" ${args}`, { timeout: 10000 });
  return stdout.trim();
}

export class HybridMacInterface implements DesktopInterface {
  
  // === Helper for AppleScript ===
  private async osascript(script: string): Promise<string> {
    const escaped = script.replace(/'/g, "'\"'\"'");
    const { stdout } = await execAsync(`osascript -e '${escaped}'`);
    return stdout.trim();
  }

  // === Core DesktopInterface Methods ===

  async click(x: number, y: number): Promise<void> {
    await runCliClick(`c:${Math.round(x)},${Math.round(y)}`);
  }

  async rightClick(x: number, y: number): Promise<void> {
    await runCliClick(`rc:${Math.round(x)},${Math.round(y)}`);
  }

  async doubleClick(x: number, y: number): Promise<void> {
    await runCliClick(`dc:${Math.round(x)},${Math.round(y)}`);
  }

  async moveCursor(x: number, y: number): Promise<void> {
    await runCliClick(`m:${Math.round(x)},${Math.round(y)}`);
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
    await runCliClick(`dd:${Math.round(fromX)},${Math.round(fromY)} du:${Math.round(toX)},${Math.round(toY)}`);
  }

  async type(text: string): Promise<void> {
    // Use AppleScript for more reliable typing (handles special chars better)
    await this.osascript(`
      tell application "System Events"
        keystroke "${text.replace(/"/g, '\\"').replace(/\\/g, '\\\\')}"
      end tell
    `);
  }

  async key(key: string): Promise<void> {
    const keyCodeMap: Record<string, number> = {
      'return': 36, 'enter': 36, 'tab': 48, 'space': 49,
      'delete': 51, 'backspace': 51, 'escape': 53, 'esc': 53,
      'up': 126, 'down': 125, 'left': 123, 'right': 124,
      'home': 115, 'end': 119, 'pageup': 116, 'pagedown': 121,
      'f1': 122, 'f2': 120, 'f3': 99, 'f4': 118,
      'f5': 96, 'f6': 97, 'f7': 98, 'f8': 100,
      'f9': 101, 'f10': 109, 'f11': 103, 'f12': 111,
    };
    
    const code = keyCodeMap[key.toLowerCase()];
    if (code !== undefined) {
      await this.osascript(`
        tell application "System Events"
          key code ${code}
        end tell
      `);
    } else {
      // For single character keys
      await this.osascript(`
        tell application "System Events"
          keystroke "${key}"
        end tell
      `);
    }
  }

  async hotkey(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    
    const modifiers = keys.slice(0, -1);
    const mainKey = keys[keys.length - 1];
    
    let modString = '';
    const modParts: string[] = [];
    
    for (const mod of modifiers) {
      const m = mod.toLowerCase();
      if (m === 'cmd' || m === 'command') modParts.push('command down');
      else if (m === 'ctrl' || m === 'control') modParts.push('control down');
      else if (m === 'alt' || m === 'option') modParts.push('option down');
      else if (m === 'shift') modParts.push('shift down');
    }
    
    modString = modParts.join(', ');
    
    if (modString) {
      await this.osascript(`
        tell application "System Events"
          keystroke "${mainKey}" using {${modString}}
        end tell
      `);
    } else {
      await this.key(mainKey);
    }
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    // Move to position first
    await runCliClick(`m:${Math.round(x)},${Math.round(y)}`);
    
    // Use cliclick scroll if available, otherwise use key simulation
    // Positive deltaY = scroll down, negative = scroll up
    if (deltaY !== 0) {
      const scrollAmount = Math.abs(Math.round(deltaY / 50));
      const direction = deltaY > 0 ? 'down' : 'up';
      
      for (let i = 0; i < scrollAmount; i++) {
        if (direction === 'down') {
          await this.osascript(`tell application "System Events" to key code 125`);
        } else {
          await this.osascript(`tell application "System Events" to key code 126`);
        }
        await this.sleep(30);
      }
    }
    
    if (deltaX !== 0) {
      const scrollAmount = Math.abs(Math.round(deltaX / 50));
      const direction = deltaX > 0 ? 'right' : 'left';
      
      for (let i = 0; i < scrollAmount; i++) {
        if (direction === 'right') {
          await this.osascript(`tell application "System Events" to key code 124`);
        } else {
          await this.osascript(`tell application "System Events" to key code 123`);
        }
        await this.sleep(30);
      }
    }
  }

  async screenshot(): Promise<Buffer> {
    const tmpPath = path.join(os.tmpdir(), `magnitude-screenshot-${Date.now()}.png`);
    await execAsync(`screencapture -x ${tmpPath}`);
    const buffer = await fs.readFile(tmpPath);
    await fs.unlink(tmpPath);
    return buffer;
  }

  async getScreenSize(): Promise<{ width: number; height: number }> {
    try {
      const result = await this.osascript(`
        tell application "Finder"
          get bounds of window of desktop
        end tell
      `);
      const parts = result.split(', ');
      return { 
        width: parseInt(parts[2]), 
        height: parseInt(parts[3]) 
      };
    } catch {
      // Fallback using system_profiler
      try {
        const { stdout } = await execAsync(
          `system_profiler SPDisplaysDataType | grep Resolution | head -1 | awk '{print $2, $4}'`
        );
        const [width, height] = stdout.trim().split(' ').map(Number);
        return { width: width || 1920, height: height || 1080 };
      } catch {
        return { width: 1920, height: 1080 };
      }
    }
  }

  async navigate(url: string): Promise<void> {
    // Use Safari by default for navigation
    await this.safariNavigate(url);
  }

  // === macOS-Specific Enhanced Methods ===

  async openApp(appName: string): Promise<void> {
    await this.osascript(`
      tell application "${appName}" to activate
    `);
    await this.sleep(1000);
  }

  async getFrontmostApp(): Promise<string> {
    return this.osascript(`
      tell application "System Events"
        return name of first process whose frontmost is true
      end tell
    `);
  }

  async focusWindow(title: string): Promise<void> {
    await this.osascript(`
      tell application "System Events"
        set frontmost of (first process whose (name of window 1) contains "${title}") to true
      end tell
    `);
  }

  // Click element by accessibility path (more reliable than coordinates)
  async clickElement(appName: string, elementPath: string): Promise<void> {
    await this.osascript(`
      tell application "System Events"
        tell process "${appName}"
          click ${elementPath}
        end tell
      end tell
    `);
  }

  // Click button by name in frontmost app
  async clickButton(buttonName: string): Promise<void> {
    await this.osascript(`
      tell application "System Events"
        tell (first process whose frontmost is true)
          click button "${buttonName}" of window 1
        end tell
      end tell
    `);
  }

  // Click menu item
  async clickMenuItem(appName: string, menuName: string, itemName: string): Promise<void> {
    await this.osascript(`
      tell application "System Events"
        tell process "${appName}"
          click menu item "${itemName}" of menu "${menuName}" of menu bar 1
        end tell
      end tell
    `);
  }

  // Safari-specific methods
  async safariNavigate(url: string): Promise<void> {
    await this.osascript(`
      tell application "Safari"
        activate
        if (count of windows) = 0 then
          make new document
        end if
        set URL of current tab of window 1 to "${url}"
      end tell
    `);
  }

  async safariGetUrl(): Promise<string> {
    return this.osascript(`
      tell application "Safari"
        return URL of current tab of window 1
      end tell
    `);
  }

  async safariGetText(): Promise<string> {
    return this.osascript(`
      tell application "Safari"
        return text of current tab of window 1
      end tell
    `);
  }

  // Finder methods
  async finderCreateFolder(location: string, name: string): Promise<void> {
    await this.osascript(`
      tell application "Finder"
        make new folder at ${location} with properties {name:"${name}"}
      end tell
    `);
  }

  // Helper sleep
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

