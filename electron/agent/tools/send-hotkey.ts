import { ToolResult, ToolContext } from './types';
import { runAppleScript, focusApp as focusAppAS } from '../../services/applescript';
import { sendHotkey as cliSendHotkey, sleep } from '../../services/cliclick';

export interface SendHotkeyParams {
  modifiers?: string[];
  key: string;
}

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

