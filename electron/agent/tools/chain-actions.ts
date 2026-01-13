import { ToolResult, ToolContext } from './types';
import { runAppleScript, focusApp } from '../../services/applescript';
import * as cliclick from '../../services/cliclick';

// Timeout limits for waiting (ms)
const TIMEOUTS = {
  appActivate: 3000,      // Max time to wait for app to become frontmost
  windowAppear: 2000,     // Max time to wait for a new window/dialog
  uiSettle: 1500,         // Max time to wait for UI to settle after typing
  default: 1000,          // Default timeout
};

// Polling intervals (ms)
const POLL_INTERVAL = 50;

// Minimum delays for actions that don't have reliable completion signals
const MIN_DELAYS = {
  afterType: 50,          // Small delay after typing for UI to update
  afterKey: 100,          // After key press
  afterClick: 100,        // After click
  afterScroll: 100,       // After scroll
};

interface Action {
  type: 'activate' | 'hotkey' | 'type' | 'key' | 'click' | 'scroll' | 'wait';
  app?: string;           // For activate
  modifiers?: string[];   // For hotkey (cmd, ctrl, alt, shift)
  key?: string;           // For hotkey, key
  text?: string;          // For type
  x?: number;             // For click
  y?: number;             // For click
  direction?: 'up' | 'down' | 'left' | 'right';  // For scroll
  amount?: number;        // For scroll, wait (ms)
}

export interface ChainActionsParams {
  actions: Action[];
}

/**
 * Execute a chain of actions with dynamic waiting between them
 */
export async function chainActions(
  params: ChainActionsParams,
  context: ToolContext
): Promise<ToolResult> {
  const results: string[] = [];
  
  try {
    for (let i = 0; i < params.actions.length; i++) {
      const action = params.actions[i];
      const nextAction = i < params.actions.length - 1 ? params.actions[i + 1] : null;
      
      // Execute the action
      const result = await executeAction(action, context);
      results.push(result);
      
      // Wait for the appropriate condition before proceeding
      if (nextAction) {
        await waitForActionComplete(action, nextAction, context);
      }
    }
    
    return { 
      success: true, 
      result: `Completed ${params.actions.length} actions: ${results.join(' → ')}` 
    };
  } catch (error) {
    return { 
      success: false, 
      error: `Failed at action ${results.length + 1}: ${error}` 
    };
  }
}

async function executeAction(action: Action, context: ToolContext): Promise<string> {
  switch (action.type) {
    case 'activate': {
      if (!action.app) throw new Error('App name required for activate');
      console.log(`[Faria] Activating app: ${action.app}`);
      await focusApp(action.app);
      context.setTargetApp(action.app);
      return `Activated ${action.app}`;
    }
    
    case 'hotkey': {
      const modifiers = action.modifiers || [];
      const key = action.key || '';
      
      const modMap: Record<string, string> = {
        'cmd': 'command down',
        'command': 'command down',
        'ctrl': 'control down',
        'control': 'control down',
        'alt': 'option down',
        'option': 'option down',
        'shift': 'shift down',
      };
      
      // Key code map for special keys
      const keyCodeMap: Record<string, number> = {
        'return': 36, 'enter': 36,
        'tab': 48,
        'space': 49,
        'delete': 51, 'backspace': 51,
        'escape': 53, 'esc': 53,
        'up': 126, 'down': 125, 'left': 123, 'right': 124,
      };
      
      const asModifiers = modifiers
        .map(m => modMap[m.toLowerCase()])
        .filter(Boolean)
        .join(', ');
      
      // Check if this is a special key that needs key code
      const keyCode = keyCodeMap[key.toLowerCase()];
      let script: string;
      
      if (keyCode !== undefined) {
        // Use key code for special keys
        script = asModifiers 
          ? `tell application "System Events" to key code ${keyCode} using {${asModifiers}}`
          : `tell application "System Events" to key code ${keyCode}`;
      } else {
        // Use keystroke for regular character keys
        script = asModifiers 
          ? `tell application "System Events" to keystroke "${key}" using {${asModifiers}}`
          : `tell application "System Events" to keystroke "${key}"`;
      }
      
      console.log(`[Faria] Executing hotkey script: ${script}`);
      await runAppleScript(script);
      return `Pressed ${modifiers.length ? modifiers.join('+') + '+' : ''}${key}`;
    }
    
    case 'type': {
      if (!action.text) throw new Error('Text required for type');
      
      // Split by newlines and type each line, pressing Return between them
      const lines = action.text.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > 0) {
          const escapedLine = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          const script = `tell application "System Events" to keystroke "${escapedLine}"`;
          console.log(`[Faria] Executing type script: ${script.slice(0, 100)}...`);
          await runAppleScript(script);
        }
        
        // Press Return for newlines (except after the last line)
        if (i < lines.length - 1) {
          await runAppleScript(`tell application "System Events" to key code 36`);
          await sleep(MIN_DELAYS.afterKey);
        }
      }
      
      return `Typed "${action.text.slice(0, 30)}${action.text.length > 30 ? '...' : ''}"`;
    }
    
    case 'key': {
      if (!action.key) throw new Error('Key required');
      
      const keyCodeMap: Record<string, number> = {
        'return': 36, 'enter': 36,
        'tab': 48,
        'space': 49,
        'delete': 51, 'backspace': 51,
        'escape': 53, 'esc': 53,
        'up': 126, 'down': 125, 'left': 123, 'right': 124,
        'home': 115, 'end': 119,
        'pageup': 116, 'pagedown': 121,
      };
      
      const keyCode = keyCodeMap[action.key.toLowerCase()];
      let script: string;
      
      if (keyCode !== undefined) {
        script = `tell application "System Events" to key code ${keyCode}`;
      } else {
        script = `tell application "System Events" to keystroke "${action.key}"`;
      }
      
      console.log(`[Faria] Executing key script: ${script}`);
      await runAppleScript(script);
      return `Pressed ${action.key}`;
    }
    
    case 'click': {
      if (action.x === undefined || action.y === undefined) {
        throw new Error('Coordinates required for click');
      }
      await cliclick.click(action.x, action.y);
      return `Clicked (${action.x}, ${action.y})`;
    }
    
    case 'scroll': {
      const direction = action.direction || 'down';
      const amount = action.amount || 3;
      await cliclick.scroll(direction, amount);
      return `Scrolled ${direction}`;
    }
    
    case 'wait': {
      const ms = action.amount || 500;
      await sleep(ms);
      return `Waited ${ms}ms`;
    }
    
    default:
      throw new Error(`Unknown action type: ${(action as Action).type}`);
  }
}

/**
 * Wait for an action to complete before proceeding to the next action
 * Uses dynamic waiting based on actual conditions rather than static delays
 */
async function waitForActionComplete(
  current: Action, 
  next: Action,
  context: ToolContext
): Promise<void> {
  switch (current.type) {
    case 'activate': {
      // Wait for app to become frontmost
      if (current.app) {
        await waitForCondition(
          () => isAppFrontmost(current.app!),
          TIMEOUTS.appActivate,
          `App ${current.app} to become frontmost`
        );
      }
      break;
    }
    
    case 'hotkey': {
      // If this is a search/dialog hotkey, wait for window count to change or UI to settle
      const isSearchHotkey = current.modifiers?.includes('cmd') && 
        ['k', 'p', 'f', 'o', 'space', 't', 'n', 'l', 'g'].includes(current.key?.toLowerCase() || '');
      
      if (isSearchHotkey) {
        // Wait for UI to settle (window/dialog to appear)
        await waitForUISettle(TIMEOUTS.windowAppear);
      } else {
        // Small delay for regular hotkeys
        await sleep(MIN_DELAYS.afterKey);
      }
      break;
    }
    
    case 'type': {
      // If next action is Enter/Return, wait longer for search results to populate
      if (next.type === 'key' && ['return', 'enter'].includes(next.key?.toLowerCase() || '')) {
        await waitForUISettle(TIMEOUTS.uiSettle);
      } else {
        await sleep(MIN_DELAYS.afterType);
      }
      break;
    }
    
    case 'key': {
      // If we pressed Enter and next is type, we likely navigated somewhere - wait for UI
      if (['return', 'enter'].includes(current.key?.toLowerCase() || '') && next.type === 'type') {
        await waitForUISettle(TIMEOUTS.windowAppear);
      } else {
        await sleep(MIN_DELAYS.afterKey);
      }
      break;
    }
    
    case 'click': {
      // After click, brief wait for UI response
      await sleep(MIN_DELAYS.afterClick);
      break;
    }
    
    case 'scroll': {
      await sleep(MIN_DELAYS.afterScroll);
      break;
    }
  }
}

/**
 * Check if an app is the frontmost application
 */
async function isAppFrontmost(appName: string): Promise<boolean> {
  try {
    const script = `tell application "System Events" to return name of first application process whose frontmost is true`;
    const result = await runAppleScript(script);
    // Normalize names for comparison (e.g., "Google Chrome" vs "Chrome")
    const normalizedResult = result?.toLowerCase().trim() || '';
    const normalizedApp = appName.toLowerCase().trim();
    return normalizedResult.includes(normalizedApp) || normalizedApp.includes(normalizedResult);
  } catch {
    return false;
  }
}

/**
 * Wait for UI to settle by checking if window count has stabilized
 * Uses a simple heuristic: wait until no new windows appear for a short period
 */
async function waitForUISettle(timeout: number): Promise<void> {
  const startTime = Date.now();
  let lastWindowCount = await getWindowCount();
  let stableCount = 0;
  const requiredStableChecks = 3; // Must be stable for 3 checks
  
  while (Date.now() - startTime < timeout) {
    await sleep(POLL_INTERVAL);
    
    const currentCount = await getWindowCount();
    
    if (currentCount === lastWindowCount) {
      stableCount++;
      if (stableCount >= requiredStableChecks) {
        // UI has stabilized
        return;
      }
    } else {
      // Window count changed, reset stability counter
      stableCount = 0;
      lastWindowCount = currentCount;
    }
  }
  
  // Timeout reached, proceed anyway
}

/**
 * Get the total window count across all apps (rough heuristic for UI changes)
 */
async function getWindowCount(): Promise<number> {
  try {
    // Simpler approach - just count windows of the frontmost app
    const script = `tell application "System Events" to return count of windows of first application process whose frontmost is true`;
    const result = await runAppleScript(script);
    return parseInt(result || '0', 10);
  } catch {
    return 0;
  }
}

/**
 * Wait for a condition to become true with timeout
 */
async function waitForCondition(
  condition: () => Promise<boolean>,
  timeout: number,
  description: string
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await sleep(POLL_INTERVAL);
  }
  
  // Log timeout but don't fail - proceed anyway
  console.log(`[Faria] Timeout waiting for: ${description}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
