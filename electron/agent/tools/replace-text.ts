/**
 * Replace Selected Text Tool
 * Replaces the currently selected text in the target app with new text.
 *
 * Key insight: When the user opens the command bar, we capture the selected text,
 * but that selection REMAINS ACTIVE in the target app. So we just need to paste
 * the replacement text - it will replace the selection.
 */

import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { clipboard } from 'electron';
import { runAppleScript, escapeForAppleScript } from '../../services/applescript';
import { ToolResult, ToolContext } from './types';

// Zod schema for the tool
export const ReplaceSelectedTextSchema = z.object({
  text: z.string().describe('The replacement text that will replace the current selection'),
});

/**
 * Factory function that creates the replace selected text tool with context injected
 * Replace the currently selected text with new text
 * Uses clipboard + paste via Edit menu for reliability
 */
export function createReplaceSelectedTextTool(context: ToolContext): DynamicStructuredTool {
  return tool(
    async (input) => {
      const { text } = input;
      const targetApp = context.targetApp;

      if (!text) {
        throw new Error('Replacement text is required');
      }

      if (!targetApp) {
        throw new Error('No target app available');
      }

      console.log(`[Faria] Replacing selected text in ${targetApp} with ${text.length} chars`);

      try {
        // Save current clipboard
        const savedClipboard = clipboard.readText();

        // Put replacement text on clipboard
        clipboard.writeText(text);

        // Small delay to ensure clipboard is set
        await sleep(50);

        // Activate target app and paste via Edit menu
        // Using menu click is more reliable than keystroke Cmd+V
        const script = `
          tell application "${escapeForAppleScript(targetApp)}"
            activate
          end tell
          delay 0.15
          tell application "System Events"
            tell process "${escapeForAppleScript(targetApp)}"
              click menu item "Paste" of menu "Edit" of menu bar 1
            end tell
          end tell
        `;

        await runAppleScript(script);

        // Wait for paste to complete
        await sleep(150);

        // Restore original clipboard
        clipboard.writeText(savedClipboard);

        return `Replaced selected text with "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`;
      } catch (error) {
        console.error('[Faria] Replace text error:', error);
        throw new Error(`Failed to replace text: ${error}`);
      }
    },
    {
      name: 'replace_selected_text',
      description: 'Replace the currently selected text in the target app with new text. Use this when the user has text selected (shown as USER SELECTED TEXT in state) and wants to modify/replace/expand it. The selected text will be replaced with your new text.',
      schema: ReplaceSelectedTextSchema,
    }
  );
}

// Legacy interface and function for backward compatibility during migration
export interface ReplaceTextParams {
  text: string;  // The replacement text
}

export async function replaceSelectedText(
  params: ReplaceTextParams,
  context: ToolContext
): Promise<ToolResult> {
  const { text } = params;
  const targetApp = context.targetApp;

  if (!text) {
    return { success: false, error: 'Replacement text is required' };
  }

  if (!targetApp) {
    return { success: false, error: 'No target app available' };
  }

  console.log(`[Faria] Replacing selected text in ${targetApp} with ${text.length} chars`);

  try {
    // Save current clipboard
    const savedClipboard = clipboard.readText();

    // Put replacement text on clipboard
    clipboard.writeText(text);

    // Small delay to ensure clipboard is set
    await sleep(50);

    // Activate target app and paste via Edit menu
    // Using menu click is more reliable than keystroke Cmd+V
    const script = `
      tell application "${escapeForAppleScript(targetApp)}"
        activate
      end tell
      delay 0.15
      tell application "System Events"
        tell process "${escapeForAppleScript(targetApp)}"
          click menu item "Paste" of menu "Edit" of menu bar 1
        end tell
      end tell
    `;

    await runAppleScript(script);

    // Wait for paste to complete
    await sleep(150);

    // Restore original clipboard
    clipboard.writeText(savedClipboard);

    return {
      success: true,
      result: `Replaced selected text with "${text.slice(0, 50)}${text.length > 50 ? '...' : ''}"`
    };
  } catch (error) {
    console.error('[Faria] Replace text error:', error);
    return {
      success: false,
      error: `Failed to replace text: ${error}`
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
