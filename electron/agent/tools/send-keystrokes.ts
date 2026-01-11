import { ToolResult, ToolContext } from './types';
import { runAppleScript, focusApp as focusAppAS } from '../../services/applescript';
import { sendKeystrokes as cliSendKeystrokes, click as cliClick, getMousePosition } from '../../services/cliclick';

export interface SendKeystrokesParams {
  text: string;
}

// Apps that need special handling (complex web apps, etc.)
const BROWSER_APPS = ['Safari', 'Google Chrome', 'Arc', 'Firefox', 'Brave Browser', 'Microsoft Edge'];

export async function sendKeystrokes(
  params: SendKeystrokesParams,
  context: ToolContext
): Promise<ToolResult> {
  // Use the target app captured when command bar opened, NOT the current frontmost app
  const appToTarget = context.targetApp;
  const isBrowser = appToTarget && BROWSER_APPS.some(b => appToTarget.includes(b));
  
  console.log(`[Faria] sendKeystrokes called, target app: ${appToTarget}, isBrowser: ${isBrowser}, text: "${params.text.slice(0, 50)}${params.text.length > 50 ? '...' : ''}"`);
  
  // Use AppleScript to send keystrokes directly to the target app
  if (appToTarget && appToTarget !== 'Electron' && appToTarget !== 'Faria') {
    try {
      // For browsers with complex web apps (like Google Docs), we need to:
      // 1. Activate the app
      // 2. Click at the current mouse position to establish focus in the web content
      // 3. Then send keystrokes
      
      if (isBrowser) {
        console.log(`[Faria] Browser detected, using enhanced focus method`);
        
        // Activate browser
        const activateScript = `
          tell application "${appToTarget}"
            activate
          end tell
        `;
        await runAppleScript(activateScript);
        
        // Click at current mouse position to establish focus in web content
        // This is crucial for apps like Google Docs that have complex focus handling
        try {
          const mousePos = await getMousePosition();
          console.log(`[Faria] Clicking at mouse position (${mousePos.x}, ${mousePos.y}) to establish focus`);
          await cliClick(mousePos.x, mousePos.y);
        } catch (clickError) {
          console.log(`[Faria] Mouse position click failed, continuing anyway:`, clickError);
        }
        
        // Use cliclick for typing as it's more reliable for web apps
        console.log(`[Faria] Using cliclick for browser typing`);
        await cliSendKeystrokes(params.text);
        console.log(`[Faria] Keystrokes sent successfully to ${appToTarget} via cliclick`);
        return { success: true, result: `Typed: "${params.text}"` };
      }
      
      // For non-browser apps, use the original AppleScript approach
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
  }
  await cliSendKeystrokes(params.text);
  return { success: true, result: `Typed: "${params.text}"` };
}

