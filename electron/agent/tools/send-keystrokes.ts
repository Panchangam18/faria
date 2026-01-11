import { ToolResult, ToolContext } from './types';
import { runAppleScript, focusApp as focusAppAS } from '../../services/applescript';
import { sendKeystrokes as cliSendKeystrokes, sleep } from '../../services/cliclick';

export interface SendKeystrokesParams {
  text: string;
}

export async function sendKeystrokes(
  params: SendKeystrokesParams,
  context: ToolContext
): Promise<ToolResult> {
  // Use the target app captured when command bar opened, NOT the current frontmost app
  const appToTarget = context.targetApp;
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

