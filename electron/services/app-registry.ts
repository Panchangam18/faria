import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { initDatabase } from '../db/sqlite';
import { runAppleScript, getAppPath, escapeForAppleScript } from './applescript';

const execAsync = promisify(exec);

export type ScriptingLanguage = 'python' | 'javascript' | 'applescript' | 'lua' | null;
export type ScriptingMethod = 'cli' | 'applescript_do_javascript' | 'applescript_do_script' | 'applescript_native' | 'socket' | null;
export type StateExtractionMethod = 'js_injection' | 'applescript' | 'accessibility';

export interface AppScriptingMethod {
  language: ScriptingLanguage;
  method: ScriptingMethod;
  template: string | null;
  verified: boolean;
}

export interface AppEntry {
  name: string;
  bundleId: string;
  scripting: AppScriptingMethod;
  stateExtraction: StateExtractionMethod;
  discoveredAt: Date;
}

/**
 * Pre-seeded app registry with known scripting methods
 */
const PRESEEDED_APPS: AppEntry[] = [
  {
    name: 'Blender',
    bundleId: 'org.blenderfoundation.blender',
    scripting: {
      language: 'python',
      method: 'cli',
      template: '/Applications/Blender.app/Contents/MacOS/Blender --background --python-expr "{code}"',
      verified: true,
    },
    stateExtraction: 'accessibility',
    discoveredAt: new Date(),
  },
  {
    name: 'Adobe Photoshop 2024',
    bundleId: 'com.adobe.Photoshop',
    scripting: {
      language: 'javascript',
      method: 'applescript_do_javascript',
      template: 'tell application "Adobe Photoshop 2024" to do javascript "{code}"',
      verified: true,
    },
    stateExtraction: 'applescript',
    discoveredAt: new Date(),
  },
  {
    name: 'Adobe Illustrator 2024',
    bundleId: 'com.adobe.Illustrator',
    scripting: {
      language: 'javascript',
      method: 'applescript_do_javascript',
      template: 'tell application "Adobe Illustrator" to do javascript "{code}"',
      verified: true,
    },
    stateExtraction: 'applescript',
    discoveredAt: new Date(),
  },
  {
    name: 'Microsoft Excel',
    bundleId: 'com.microsoft.Excel',
    scripting: {
      language: 'applescript',
      method: 'applescript_native',
      template: null,
      verified: true,
    },
    stateExtraction: 'applescript',
    discoveredAt: new Date(),
  },
  {
    name: 'Microsoft Word',
    bundleId: 'com.microsoft.Word',
    scripting: {
      language: 'applescript',
      method: 'applescript_native',
      template: null,
      verified: true,
    },
    stateExtraction: 'applescript',
    discoveredAt: new Date(),
  },
  {
    name: 'Microsoft PowerPoint',
    bundleId: 'com.microsoft.Powerpoint',
    scripting: {
      language: 'applescript',
      method: 'applescript_native',
      template: null,
      verified: true,
    },
    stateExtraction: 'applescript',
    discoveredAt: new Date(),
  },
  {
    name: 'Google Chrome',
    bundleId: 'com.google.Chrome',
    scripting: {
      language: 'javascript',
      method: 'applescript_do_javascript',
      template: 'tell application "Google Chrome" to execute front window\'s active tab javascript "{code}"',
      verified: true,
    },
    stateExtraction: 'js_injection',
    discoveredAt: new Date(),
  },
  {
    name: 'Safari',
    bundleId: 'com.apple.Safari',
    scripting: {
      language: 'javascript',
      method: 'applescript_do_javascript',
      template: 'tell application "Safari" to do JavaScript "{code}" in current tab of front window',
      verified: true,
    },
    stateExtraction: 'js_injection',
    discoveredAt: new Date(),
  },
  {
    name: 'Arc',
    bundleId: 'company.thebrowser.Browser',
    scripting: {
      language: 'javascript',
      method: 'applescript_do_javascript',
      template: 'tell application "Arc" to execute front window\'s active tab javascript "{code}"',
      verified: true,
    },
    stateExtraction: 'js_injection',
    discoveredAt: new Date(),
  },
  {
    name: 'Terminal',
    bundleId: 'com.apple.Terminal',
    scripting: {
      language: 'applescript',
      method: 'applescript_do_script',
      template: 'tell application "Terminal" to do script "{code}" in front window',
      verified: true,
    },
    stateExtraction: 'applescript',
    discoveredAt: new Date(),
  },
  {
    name: 'iTerm2',
    bundleId: 'com.googlecode.iterm2',
    scripting: {
      language: 'applescript',
      method: 'applescript_do_script',
      template: 'tell application "iTerm2" to tell current session of current window to write text "{code}"',
      verified: true,
    },
    stateExtraction: 'accessibility',
    discoveredAt: new Date(),
  },
  {
    name: 'Visual Studio Code',
    bundleId: 'com.microsoft.VSCode',
    scripting: {
      language: null,
      method: null,
      template: null,
      verified: true,
    },
    stateExtraction: 'accessibility',
    discoveredAt: new Date(),
  },
  {
    name: 'Figma',
    bundleId: 'com.figma.Desktop',
    scripting: {
      language: null,
      method: null,
      template: null,
      verified: true,
    },
    stateExtraction: 'accessibility',
    discoveredAt: new Date(),
  },
];

export class AppRegistry {
  private cache: Map<string, AppEntry> = new Map();
  
  constructor() {
    // Initialize cache with pre-seeded apps
    PRESEEDED_APPS.forEach((app) => {
      this.cache.set(app.name.toLowerCase(), app);
      this.cache.set(app.bundleId.toLowerCase(), app);
    });
  }
  
  /**
   * Get the scripting method for an application
   */
  async getScriptingMethod(appName: string): Promise<AppScriptingMethod | null> {
    const entry = await this.getEntry(appName);
    return entry?.scripting || null;
  }
  
  /**
   * Get the full app entry
   */
  async getEntry(appName: string): Promise<AppEntry | null> {
    const key = appName.toLowerCase();
    
    // Check in-memory cache
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    
    // Check database
    try {
      const db = initDatabase();
      const row = db.prepare(
        'SELECT * FROM app_registry WHERE LOWER(name) = ? OR LOWER(bundle_id) = ?'
      ).get(key, key) as { name: string; bundle_id: string; scripting_method: string; state_extraction: string; discovered_at: string } | undefined;
      
      if (row) {
        const entry: AppEntry = {
          name: row.name,
          bundleId: row.bundle_id,
          scripting: JSON.parse(row.scripting_method || '{}'),
          stateExtraction: row.state_extraction as StateExtractionMethod,
          discoveredAt: new Date(row.discovered_at),
        };
        this.cache.set(key, entry);
        return entry;
      }
    } catch (error) {
      console.error('Error reading from app registry:', error);
    }
    
    // Auto-discover
    const discovered = await this.discover(appName);
    if (discovered) {
      await this.saveEntry(discovered);
      return discovered;
    }
    
    return null;
  }
  
  /**
   * Auto-discover scripting capabilities for an app
   */
  private async discover(appName: string): Promise<AppEntry | null> {
    const appPath = await getAppPath(appName);
    if (!appPath) {
      return null;
    }
    
    const bundleId = await this.getBundleId(appPath);
    
    // 1. Check sdef for AppleScript dictionary
    const sdefResult = await this.checkSdef(appPath);
    if (sdefResult) {
      return {
        name: appName,
        bundleId: bundleId || appName,
        scripting: sdefResult,
        stateExtraction: 'applescript',
        discoveredAt: new Date(),
      };
    }
    
    // 2. Probe CLI for scripting flags
    const cliResult = await this.probeCli(appPath, appName);
    if (cliResult) {
      return {
        name: appName,
        bundleId: bundleId || appName,
        scripting: cliResult,
        stateExtraction: 'accessibility',
        discoveredAt: new Date(),
      };
    }
    
    // 3. Return basic entry with no scripting
    return {
      name: appName,
      bundleId: bundleId || appName,
      scripting: {
        language: null,
        method: null,
        template: null,
        verified: false,
      },
      stateExtraction: 'accessibility',
      discoveredAt: new Date(),
    };
  }
  
  /**
   * Check sdef for AppleScript dictionary
   */
  private async checkSdef(appPath: string): Promise<AppScriptingMethod | null> {
    try {
      const { stdout } = await execAsync(`sdef "${appPath}" 2>/dev/null | head -c 5000`);
      
      if (stdout.includes('do javascript')) {
        return {
          language: 'javascript',
          method: 'applescript_do_javascript',
          template: `tell application "${appPath}" to do javascript "{code}"`,
          verified: false,
        };
      }
      
      if (stdout.includes('do script')) {
        return {
          language: 'applescript',
          method: 'applescript_do_script',
          template: `tell application "${appPath}" to do script "{code}"`,
          verified: false,
        };
      }
      
      // Has some AppleScript support
      if (stdout.length > 100) {
        return {
          language: 'applescript',
          method: 'applescript_native',
          template: null,
          verified: false,
        };
      }
    } catch {
      // No sdef available
    }
    
    return null;
  }
  
  /**
   * Probe CLI for scripting flags
   */
  private async probeCli(appPath: string, appName: string): Promise<AppScriptingMethod | null> {
    // Get the binary name
    const binaryName = appPath.split('/').pop()?.replace('.app', '') || appName;
    const binaryPath = `${appPath}/Contents/MacOS/${binaryName}`;
    
    if (!existsSync(binaryPath)) {
      return null;
    }
    
    try {
      const { stdout, stderr } = await execAsync(`"${binaryPath}" --help 2>&1 | head -c 5000`, {
        timeout: 5000,
      });
      const help = stdout + stderr;
      
      if (help.includes('--python-expr') || help.includes('--python-console')) {
        return {
          language: 'python',
          method: 'cli',
          template: `"${binaryPath}" --python-expr "{code}"`,
          verified: false,
        };
      }
      
      if (help.includes('--python') && !help.includes('--python-expr')) {
        return {
          language: 'python',
          method: 'cli',
          template: `"${binaryPath}" --python "{code}"`,
          verified: false,
        };
      }
      
      if (help.includes('--script') || help.includes('-script')) {
        return {
          language: 'javascript',
          method: 'cli',
          template: `"${binaryPath}" --script "{code}"`,
          verified: false,
        };
      }
    } catch {
      // CLI probe failed
    }
    
    return null;
  }
  
  /**
   * Get bundle ID from app path
   */
  private async getBundleId(appPath: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `defaults read "${appPath}/Contents/Info" CFBundleIdentifier 2>/dev/null`
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
  
  /**
   * Save an entry to the database
   */
  private async saveEntry(entry: AppEntry): Promise<void> {
    try {
      const db = initDatabase();
      db.prepare(`
        INSERT OR REPLACE INTO app_registry (bundle_id, name, scripting_method, state_extraction, discovered_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(
        entry.bundleId,
        entry.name,
        JSON.stringify(entry.scripting),
        entry.stateExtraction
      );
      
      // Update cache
      this.cache.set(entry.name.toLowerCase(), entry);
      this.cache.set(entry.bundleId.toLowerCase(), entry);
    } catch (error) {
      console.error('Error saving to app registry:', error);
    }
  }
  
  /**
   * Get all registered apps
   */
  getAllEntries(): AppEntry[] {
    return Array.from(this.cache.values());
  }
}

