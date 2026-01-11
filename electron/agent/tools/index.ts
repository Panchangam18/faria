import { v4 as uuidv4 } from 'uuid';
import { initDatabase } from '../../db/sqlite';
import { AppRegistry } from '../../services/app-registry';
import { StateExtractor, AppState } from '../../services/state-extractor';
import { runAppleScript, escapeForAppleScript, focusApp as focusAppAS } from '../../services/applescript';
import { sendKeystrokes as cliSendKeystrokes, sendHotkey as cliSendHotkey, click as cliClick, scroll as cliScroll, sleep } from '../../services/cliclick';
import { takeScreenshot } from '../../services/screenshot';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ToolResult {
  success: boolean;
  result?: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
      items?: { type: string };
    }>;
    required: string[];
  };
}

/**
 * Tool Executor - handles execution of all built-in and custom tools
 */
export class ToolExecutor {
  private appRegistry: AppRegistry;
  private stateExtractor: StateExtractor;
  private currentState: AppState | null = null;
  private targetApp: string | null = null; // The app that was focused when command bar opened
  
  constructor(appRegistry: AppRegistry, stateExtractor: StateExtractor) {
    this.appRegistry = appRegistry;
    this.stateExtractor = stateExtractor;
  }
  
  /**
   * Set the target app for actions (captured when command bar opens)
   */
  setTargetApp(appName: string | null): void {
    this.targetApp = appName;
    console.log(`[Faria] Tool executor target app set to: ${appName}`);
  }
  
  /**
   * Set the current state for element ID resolution
   */
  setCurrentState(state: AppState): void {
    this.currentState = state;
  }
  
  /**
   * Get all tool definitions for Claude
   */
  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'execute_script',
        description: 'Execute native code in an application\'s scripting runtime (Python for Blender, JavaScript for Photoshop, AppleScript for Office apps)',
        parameters: {
          type: 'object',
          properties: {
            app: { type: 'string', description: 'Name of the application to execute code in' },
            code: { type: 'string', description: 'The code to execute' },
            language: { 
              type: 'string', 
              description: 'Override language (optional)',
              enum: ['python', 'javascript', 'applescript']
            },
          },
          required: ['app', 'code'],
        },
      },
      {
        name: 'send_keystrokes',
        description: 'Type text using keyboard simulation',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The text to type' },
          },
          required: ['text'],
        },
      },
      {
        name: 'send_hotkey',
        description: 'Send a keyboard shortcut (e.g., Cmd+C, Ctrl+Shift+P)',
        parameters: {
          type: 'object',
          properties: {
            modifiers: { 
              type: 'array',
              items: { type: 'string' },
              description: 'Modifier keys: cmd, ctrl, alt, shift'
            },
            key: { type: 'string', description: 'The key to press (e.g., c, v, enter, tab, escape)' },
          },
          required: ['key'],
        },
      },
      {
        name: 'click',
        description: 'Click at a location. Can use element ID from state (e.g., 12) or coordinates (e.g., {x: 100, y: 200})',
        parameters: {
          type: 'object',
          properties: {
            target: { 
              type: 'string', 
              description: 'Element ID number or JSON coordinates {x, y}'
            },
          },
          required: ['target'],
        },
      },
      {
        name: 'scroll',
        description: 'Scroll the current view',
        parameters: {
          type: 'object',
          properties: {
            direction: { 
              type: 'string',
              enum: ['up', 'down', 'left', 'right'],
              description: 'Direction to scroll'
            },
            amount: { type: 'number', description: 'Number of pages to scroll (default: 1)' },
          },
          required: ['direction'],
        },
      },
      {
        name: 'focus_app',
        description: 'Bring an application to the foreground',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name of the application to focus' },
          },
          required: ['name'],
        },
      },
      {
        name: 'get_state',
        description: 'Re-extract the current application state',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'take_screenshot',
        description: 'Capture a screenshot of the current screen for visual analysis',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'find_replace',
        description: 'Find and replace text using keyboard shortcuts (Cmd+H)',
        parameters: {
          type: 'object',
          properties: {
            find: { type: 'string', description: 'Text to find' },
            replace: { type: 'string', description: 'Text to replace with' },
          },
          required: ['find', 'replace'],
        },
      },
      {
        name: 'run_applescript',
        description: 'Execute raw AppleScript code',
        parameters: {
          type: 'object',
          properties: {
            script: { type: 'string', description: 'The AppleScript code to execute' },
          },
          required: ['script'],
        },
      },
      {
        name: 'run_shell',
        description: 'Execute a shell command',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute' },
          },
          required: ['command'],
        },
      },
      {
        name: 'search_tools',
        description: 'Search for custom tools by query',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            type: { 
              type: 'string',
              enum: ['bm25', 'grep'],
              description: 'Search type (default: bm25)'
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'create_tool',
        description: 'Create a new custom tool for future use',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Tool name (snake_case)' },
            description: { type: 'string', description: 'What the tool does' },
            parameters: { type: 'string', description: 'JSON schema for parameters' },
            code: { type: 'string', description: 'JavaScript code implementing the tool' },
          },
          required: ['name', 'description', 'parameters', 'code'],
        },
      },
    ];
  }
  
  /**
   * Execute a tool by name
   */
  async execute(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (toolName) {
        case 'execute_script':
          return await this.executeScript(params as { app: string; code: string; language?: string });
        case 'send_keystrokes':
          return await this.sendKeystrokes(params as { text: string });
        case 'send_hotkey':
          return await this.sendHotkey(params as { modifiers?: string[]; key: string });
        case 'click':
          return await this.click(params as { target: string });
        case 'scroll':
          return await this.scroll(params as { direction: 'up' | 'down' | 'left' | 'right'; amount?: number });
        case 'focus_app':
          return await this.focusApp(params as { name: string });
        case 'get_state':
          return await this.getState();
        case 'take_screenshot':
          return await this.takeScreenshotTool();
        case 'find_replace':
          return await this.findReplace(params as { find: string; replace: string });
        case 'run_applescript':
          return await this.runAppleScriptTool(params as { script: string });
        case 'run_shell':
          return await this.runShell(params as { command: string });
        case 'search_tools':
          return await this.searchTools(params as { query: string; type?: 'bm25' | 'grep' });
        case 'create_tool':
          return await this.createTool(params as {
            name: string;
            description: string;
            parameters: string;
            code: string;
          });
        default:
          // Try custom tool
          return await this.executeCustomTool(toolName, params);
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  
  // ============== Tool Implementations ==============
  
  private async executeScript(params: { app: string; code: string; language?: string }): Promise<ToolResult> {
    const { app, code, language } = params;
    
    const method = await this.appRegistry.getScriptingMethod(app);
    
    if (!method || !method.method) {
      return {
        success: false,
        error: `No scripting method found for ${app}. Try run_applescript or run_shell directly.`,
      };
    }
    
    if (language && method.language !== language) {
      return {
        success: false,
        error: `${app} uses ${method.language}, not ${language}`,
      };
    }
    
    switch (method.method) {
      case 'cli':
        if (!method.template) {
          return { success: false, error: 'No CLI template defined' };
        }
        const escapedCode = code.replace(/"/g, '\\"').replace(/\$/g, '\\$');
        const cmd = method.template.replace('{code}', escapedCode);
        const { stdout } = await execAsync(cmd, { timeout: 30000 });
        return { success: true, result: stdout };
        
      case 'applescript_do_javascript':
        if (!method.template) {
          return { success: false, error: 'No AppleScript template defined' };
        }
        const asScript = method.template.replace('{code}', escapeForAppleScript(code));
        const result = await runAppleScript(asScript);
        return { success: true, result };
        
      case 'applescript_do_script':
        if (!method.template) {
          return { success: false, error: 'No AppleScript template defined' };
        }
        const doScriptResult = await runAppleScript(method.template.replace('{code}', escapeForAppleScript(code)));
        return { success: true, result: doScriptResult };
        
      case 'applescript_native':
        const nativeResult = await runAppleScript(code);
        return { success: true, result: nativeResult };
        
      default:
        return { success: false, error: `Unknown method: ${method.method}` };
    }
  }
  
  private async sendKeystrokes(params: { text: string }): Promise<ToolResult> {
    // Use the target app captured when command bar opened, NOT the current frontmost app
    const appToTarget = this.targetApp;
    console.log(`[Faria] sendKeystrokes called, target app: ${appToTarget}, text: "${params.text.slice(0, 50)}${params.text.length > 50 ? '...' : ''}"`);
    
    // Use AppleScript to send keystrokes directly to the target app
    if (appToTarget && appToTarget !== 'Electron' && appToTarget !== 'Faria') {
      try {
        // Escape the text for AppleScript - handle special characters
        const escapedText = params.text
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
        
        console.log(`[Faria] Activating "${appToTarget}" and sending keystrokes via AppleScript`);
        
        const script = `
          tell application "${appToTarget}"
            activate
          end tell
          delay 0.3
          tell application "System Events"
            keystroke "${escapedText}"
          end tell
        `;
        
        await runAppleScript(script);
        console.log(`[Faria] Keystrokes sent successfully to ${appToTarget}`);
        return { success: true, result: `Typed: "${params.text}"` };
      } catch (error) {
        console.error(`[Faria] AppleScript keystroke failed:`, error);
        // Fall through to cliclick
      }
    }
    
    // Fallback: activate and use cliclick
    console.log(`[Faria] Falling back to cliclick for keystrokes`);
    if (appToTarget) {
      await focusAppAS(appToTarget);
      await sleep(300);
    }
    await cliSendKeystrokes(params.text);
    return { success: true, result: `Typed: "${params.text}"` };
  }
  
  private async sendHotkey(params: { modifiers?: string[]; key: string }): Promise<ToolResult> {
    const appToTarget = this.targetApp;
    const modStr = params.modifiers?.length ? params.modifiers.join('+') + '+' : '';
    console.log(`[Faria] sendHotkey called, target app: ${appToTarget}, keys: ${modStr}${params.key}`);
    
    // Use AppleScript to send hotkey directly to the target app
    if (appToTarget && appToTarget !== 'Electron' && appToTarget !== 'Faria') {
      try {
        console.log(`[Faria] Activating "${appToTarget}" and sending hotkey via AppleScript`);
        
        // Build AppleScript modifier string
        const modMap: Record<string, string> = {
          'cmd': 'command down',
          'command': 'command down',
          'ctrl': 'control down',
          'control': 'control down',
          'alt': 'option down',
          'option': 'option down',
          'shift': 'shift down',
        };
        
        const asModifiers = (params.modifiers || [])
          .map(m => modMap[m.toLowerCase()])
          .filter(Boolean)
          .join(', ');
        
        const script = `
          tell application "${appToTarget}"
            activate
          end tell
          delay 0.3
          tell application "System Events"
            keystroke "${params.key}"${asModifiers ? ` using {${asModifiers}}` : ''}
          end tell
        `;
        
        await runAppleScript(script);
        console.log(`[Faria] Hotkey sent successfully to ${appToTarget}`);
        return { success: true, result: `Pressed: ${modStr}${params.key}` };
      } catch (error) {
        console.error(`[Faria] AppleScript hotkey failed:`, error);
      }
    }
    
    // Fallback to cliclick
    console.log(`[Faria] Falling back to cliclick for hotkey`);
    if (appToTarget) {
      await focusAppAS(appToTarget);
      await sleep(300);
    }
    await cliSendHotkey(params.modifiers || [], params.key);
    return { success: true, result: `Pressed: ${modStr}${params.key}` };
  }
  
  private async click(params: { target: string }): Promise<ToolResult> {
    const { target } = params;
    
    // Use the target app captured when command bar opened
    const appToTarget = this.targetApp;
    if (appToTarget && appToTarget !== 'Electron' && appToTarget !== 'Faria') {
      console.log(`[Faria] Activating "${appToTarget}" before clicking`);
      await focusAppAS(appToTarget);
      await sleep(300); // Wait for focus to switch
    }
    
    // Try to parse as element ID
    const elementId = parseInt(target, 10);
    if (!isNaN(elementId) && this.currentState) {
      const pos = this.stateExtractor.getElementById(this.currentState, elementId);
      if (pos) {
        await cliClick(pos.x, pos.y);
        return { success: true, result: `Clicked element [${elementId}] at (${pos.x}, ${pos.y})` };
      }
    }
    
    // Try to parse as coordinates
    try {
      const coords = JSON.parse(target);
      if (typeof coords.x === 'number' && typeof coords.y === 'number') {
        await cliClick(coords.x, coords.y);
        return { success: true, result: `Clicked at (${coords.x}, ${coords.y})` };
      }
    } catch {
      // Not JSON
    }
    
    return { success: false, error: `Invalid click target: ${target}` };
  }
  
  private async scroll(params: { direction: 'up' | 'down' | 'left' | 'right'; amount?: number }): Promise<ToolResult> {
    await cliScroll(params.direction, params.amount || 1);
    return { success: true, result: `Scrolled ${params.direction} ${params.amount || 1} page(s)` };
  }
  
  private async focusApp(params: { name: string }): Promise<ToolResult> {
    await focusAppAS(params.name);
    return { success: true, result: `Focused: ${params.name}` };
  }
  
  private async getState(): Promise<ToolResult> {
    const state = await this.stateExtractor.extractState();
    this.currentState = state;
    return { success: true, result: this.stateExtractor.formatForAgent(state) };
  }
  
  private async takeScreenshotTool(): Promise<ToolResult> {
    const screenshot = await takeScreenshot();
    return { success: true, result: screenshot };
  }
  
  private async findReplace(params: { find: string; replace: string }): Promise<ToolResult> {
    const { find, replace } = params;
    
    // Open Find & Replace dialog
    await cliSendHotkey(['cmd'], 'h');
    await sleep(200);
    
    // Type find text
    await cliSendKeystrokes(find);
    await sleep(50);
    
    // Tab to replace field
    await cliSendHotkey([], 'tab');
    await sleep(50);
    
    // Type replace text
    await cliSendKeystrokes(replace);
    await sleep(50);
    
    // Press Enter for Replace All
    await cliSendHotkey(['cmd'], 'return');
    await sleep(100);
    
    // Close dialog
    await cliSendHotkey([], 'escape');
    
    return { success: true, result: `Replaced "${find}" with "${replace}"` };
  }
  
  private async runAppleScriptTool(params: { script: string }): Promise<ToolResult> {
    const result = await runAppleScript(params.script);
    return { success: true, result };
  }
  
  private async runShell(params: { command: string }): Promise<ToolResult> {
    const { stdout, stderr } = await execAsync(params.command, { timeout: 30000 });
    return { success: true, result: stdout || stderr };
  }
  
  private async searchTools(params: { query: string; type?: 'bm25' | 'grep' }): Promise<ToolResult> {
    const db = initDatabase();
    const tools = db.prepare('SELECT id, name, description FROM custom_tools').all() as Array<{
      id: string;
      name: string;
      description: string;
    }>;
    
    const searchType = params.type || 'bm25';
    let matches: typeof tools;
    
    if (searchType === 'grep') {
      const regex = new RegExp(params.query, 'i');
      matches = tools.filter(t => regex.test(t.name) || regex.test(t.description));
    } else {
      // Simple BM25-like scoring
      const queryTerms = params.query.toLowerCase().split(/\s+/);
      const scored = tools.map(t => {
        const text = `${t.name} ${t.description}`.toLowerCase();
        const score = queryTerms.reduce((sum, term) => {
          return sum + (text.includes(term) ? 1 : 0);
        }, 0);
        return { ...t, score };
      });
      matches = scored.filter(t => t.score > 0).sort((a, b) => b.score - a.score);
    }
    
    if (matches.length === 0) {
      return { success: true, result: 'No matching tools found.' };
    }
    
    const result = matches.slice(0, 5).map(t => `- ${t.name}: ${t.description}`).join('\n');
    return { success: true, result };
  }
  
  private async createTool(params: {
    name: string;
    description: string;
    parameters: string;
    code: string;
  }): Promise<ToolResult> {
    const db = initDatabase();
    const id = uuidv4();
    
    db.prepare(`
      INSERT INTO custom_tools (id, name, description, parameters, code, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(id, params.name, params.description, params.parameters, params.code);
    
    return { success: true, result: `Created tool: ${params.name}` };
  }
  
  private async executeCustomTool(toolName: string, params: Record<string, unknown>): Promise<ToolResult> {
    const db = initDatabase();
    const tool = db.prepare('SELECT * FROM custom_tools WHERE name = ?').get(toolName) as {
      id: string;
      code: string;
      usage_count: number;
    } | undefined;
    
    if (!tool) {
      return { success: false, error: `Unknown tool: ${toolName}` };
    }
    
    // Update usage count
    db.prepare('UPDATE custom_tools SET usage_count = usage_count + 1 WHERE id = ?').run(tool.id);
    
    // Create context for custom tool execution
    const context = {
      builtInTools: {
        sendKeystrokes: (text: string) => cliSendKeystrokes(text),
        sendHotkey: (mods: string[], key: string) => cliSendHotkey(mods, key),
        click: async (target: string) => {
          const result = await this.click({ target });
          if (!result.success) throw new Error(result.error);
        },
        executeScript: async (app: string, code: string) => {
          const result = await this.executeScript({ app, code });
          if (!result.success) throw new Error(result.error);
          return result.result;
        },
        focusApp: (name: string) => focusAppAS(name),
        getState: () => this.stateExtractor.extractState(),
        scroll: (dir: 'up' | 'down' | 'left' | 'right', amt?: number) => cliScroll(dir, amt),
      },
      runAppleScript,
      runShell: async (cmd: string) => {
        const { stdout } = await execAsync(cmd);
        return stdout;
      },
      sleep,
    };
    
    try {
      // Execute custom tool code
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('params', 'context', tool.code);
      const result = await fn(params, context);
      return { success: true, result: String(result) };
    } catch (error) {
      return { success: false, error: `Custom tool error: ${error}` };
    }
  }
}

