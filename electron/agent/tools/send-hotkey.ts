import { ToolResult, ToolContext } from './types';
import { runAppleScript, focusApp as focusAppAS } from '../../services/applescript';
import { sendHotkey as cliSendHotkey, sleep } from '../../services/cliclick';

export interface SendHotkeyParams {
  modifiers?: string[];
  key: string;
}

// Map of special keys to their macOS key codes
const KEY_CODE_MAP: Record<string, number> = {
  'return': 36, 'enter': 36,
  'tab': 48,
  'space': 49,
  'delete': 51, 'backspace': 51,
  'escape': 53, 'esc': 53,
  'up': 126, 'down': 125, 'left': 123, 'right': 124,
  'home': 115, 'end': 119,
  'pageup': 116, 'pagedown': 121,
  'f1': 122, 'f2': 120, 'f3': 99, 'f4': 118,
  'f5': 96, 'f6': 97, 'f7': 98, 'f8': 100,
  'f9': 101, 'f10': 109, 'f11': 103, 'f12': 111,
};

export async function sendHotkey(
  params: SendHotkeyParams,
  context: ToolContext
): Promise<ToolResult> {
  const appToTarget = context.targetApp;
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
      
      // Check if this is a special key that needs key code instead of keystroke
      const keyCode = KEY_CODE_MAP[params.key.toLowerCase()];
      
      let keyCommand: string;
      if (keyCode !== undefined) {
        // Use key code for special keys (return, tab, escape, arrows, etc.)
        keyCommand = asModifiers 
          ? `key code ${keyCode} using {${asModifiers}}`
          : `key code ${keyCode}`;
      } else {
        // Use keystroke for regular character keys
        keyCommand = asModifiers
          ? `keystroke "${params.key}" using {${asModifiers}}`
          : `keystroke "${params.key}"`;
      }
      
      const script = `
        tell application "${appToTarget}"
          activate
        end tell
        delay 0.3
        tell application "System Events"
          ${keyCommand}
        end tell
      `;
      
      console.log(`[Faria] Executing hotkey script: ${keyCommand}`);
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

