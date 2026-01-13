/**
 * Text Extraction Service
 * Extracts text around the cursor using keyboard shortcuts and clipboard
 */

import { clipboard } from 'electron';
import * as cliclick from './cliclick';
import { runAppleScript } from './applescript';

/**
 * Send a hotkey using AppleScript (more reliable for modifier combos)
 */
async function sendHotkeyAS(modifiers: string[], key: string): Promise<void> {
  // Map key names to AppleScript key codes
  const keyCodeMap: Record<string, number> = {
    'arrow-left': 123,
    'arrow-right': 124, 
    'arrow-up': 126,
    'arrow-down': 125,
    'return': 36,
    'enter': 36,
    'tab': 48,
    'escape': 53,
    'space': 49,
    'c': 8,
    'v': 9,
    'a': 0,
    'f': 3,
  };
  
  const modMap: Record<string, string> = {
    'cmd': 'command down',
    'command': 'command down',
    'shift': 'shift down',
    'alt': 'option down',
    'option': 'option down',
    'ctrl': 'control down',
    'control': 'control down',
  };
  
  const keyCode = keyCodeMap[key.toLowerCase()];
  const modString = modifiers.map(m => modMap[m.toLowerCase()]).filter(Boolean).join(', ');
  
  let script: string;
  if (keyCode !== undefined) {
    script = modString 
      ? `tell application "System Events" to key code ${keyCode} using {${modString}}`
      : `tell application "System Events" to key code ${keyCode}`;
  } else {
    // For regular characters, use keystroke
    script = modString
      ? `tell application "System Events" to keystroke "${key}" using {${modString}}`
      : `tell application "System Events" to keystroke "${key}"`;
  }
  
  await runAppleScript(script);
}

export interface ExtractedText {
  text: string;
  wordsBefore: number;
  wordsAfter: number;
  cursorPosition: number; // Character position of cursor in the extracted text
}

/**
 * Get the currently selected text by copying it to clipboard
 * Returns null if nothing is selected
 */
export async function getSelectedText(targetApp: string | null): Promise<string | null> {
  const savedClipboard = clipboard.readText();
  
  try {
    clipboard.writeText('');
    
    if (targetApp && targetApp !== 'Electron' && targetApp !== 'Faria') {
      await runAppleScript(`tell application "${targetApp}" to activate`);
      await cliclick.sleep(50);
    }
    
    await sendHotkeyAS(['cmd'], 'c');
    await cliclick.sleep(100);
    
    const selectedText = clipboard.readText();
    
    if (!selectedText || selectedText === '') {
      return null;
    }
    
    return selectedText;
  } finally {
    setTimeout(() => clipboard.writeText(savedClipboard), 200);
  }
}

/**
 * Extract ~100 words around the current cursor position
 * Uses keyboard selection (Option+Shift+Arrow) to select text before/after cursor
 */
export async function extractTextAroundCursor(targetApp: string | null): Promise<ExtractedText | null> {
  // Save current clipboard content
  const savedClipboard = clipboard.readText();
  
  try {
    // First, ensure the target app is focused
    if (targetApp && targetApp !== 'Electron' && targetApp !== 'Faria') {
      await runAppleScript(`tell application "${targetApp}" to activate`);
      await cliclick.sleep(50);
    }

    // Strategy: Select text before cursor, copy, then select text after cursor, copy
    // Option+Shift+Left selects one word at a time going backward
    // Option+Shift+Right selects one word at a time going forward
    
    // Step 1: Select ~50 words BEFORE cursor
    let textBefore = '';
    try {
      // Select 50 words before (Option+Shift+Left repeated)
      for (let i = 0; i < 50; i++) {
        await sendHotkeyAS(['option', 'shift'], 'arrow-left');
        await cliclick.sleep(5);
      }
      
      // Copy selection
      await sendHotkeyAS(['cmd'], 'c');
      await cliclick.sleep(50);
      textBefore = clipboard.readText();
      
      // Deselect by moving right (this puts cursor back near original position)
      await sendHotkeyAS([], 'arrow-right');
      await cliclick.sleep(20);
    } catch (e) {
      console.log('[TextExtraction] Failed to get text before cursor:', e);
    }

    // Step 2: Select ~50 words AFTER cursor  
    let textAfter = '';
    try {
      // Select 50 words after (Option+Shift+Right repeated)
      for (let i = 0; i < 50; i++) {
        await sendHotkeyAS(['option', 'shift'], 'arrow-right');
        await cliclick.sleep(5);
      }
      
      // Copy selection
      await sendHotkeyAS(['cmd'], 'c');
      await cliclick.sleep(50);
      textAfter = clipboard.readText();
      
      // Deselect by moving left back to original position
      await sendHotkeyAS([], 'arrow-left');
      await cliclick.sleep(20);
    } catch (e) {
      console.log('[TextExtraction] Failed to get text after cursor:', e);
    }

    // Combine text
    const fullText = textBefore + textAfter;
    
    if (!fullText.trim()) {
      return null;
    }

    // Count words
    const wordsBeforeCount = textBefore.trim() ? textBefore.trim().split(/\s+/).length : 0;
    const wordsAfterCount = textAfter.trim() ? textAfter.trim().split(/\s+/).length : 0;

    return {
      text: fullText,
      wordsBefore: wordsBeforeCount,
      wordsAfter: wordsAfterCount,
      cursorPosition: textBefore.length
    };
  } finally {
    // Restore original clipboard
    clipboard.writeText(savedClipboard);
  }
}

/**
 * Faster extraction using Cmd+A for small text fields, or paragraph selection
 * Falls back to the word-by-word method for large documents
 */
export async function extractTextFast(targetApp: string | null): Promise<ExtractedText | null> {
  const savedClipboard = clipboard.readText();
  
  try {
    if (targetApp && targetApp !== 'Electron' && targetApp !== 'Faria') {
      await runAppleScript(`tell application "${targetApp}" to activate`);
      await cliclick.sleep(50);
    }

    // Try selecting current paragraph (triple-click or Cmd+Shift+Up/Down from cursor)
    // For most apps, selecting the current line + adjacent lines is good enough
    
    // Get position marker: select nothing and copy to clear
    clipboard.writeText('');
    
    // Select from line start to cursor
    await sendHotkeyAS(['cmd', 'shift'], 'arrow-left');
    await cliclick.sleep(30);
    await sendHotkeyAS(['cmd'], 'c');
    await cliclick.sleep(50);
    const textBefore = clipboard.readText();
    await sendHotkeyAS([], 'arrow-right');
    await cliclick.sleep(20);
    
    // Select from cursor to line end
    await sendHotkeyAS(['cmd', 'shift'], 'arrow-right');
    await cliclick.sleep(30);
    await sendHotkeyAS(['cmd'], 'c');
    await cliclick.sleep(50);
    const textAfter = clipboard.readText();
    await sendHotkeyAS([], 'arrow-left');
    
    const fullText = textBefore + textAfter;
    
    // Return whatever we got - don't fall back to the slow method
    // Even a small amount of context is useful, and the slow method takes ~10 seconds
    if (!fullText.trim()) {
      return null;
    }

    const wordsBeforeCount = textBefore.trim() ? textBefore.trim().split(/\s+/).length : 0;
    const wordsAfterCount = textAfter.trim() ? textAfter.trim().split(/\s+/).length : 0;

    return {
      text: fullText,
      wordsBefore: wordsBeforeCount,
      wordsAfter: wordsAfterCount,
      cursorPosition: textBefore.length
    };
  } finally {
    clipboard.writeText(savedClipboard);
  }
}

/**
 * Apply text edits
 * Since the user already has text selected, we just replace it directly
 */
export interface TextEdit {
  oldText: string;  // The original text (for reference)
  newText: string;  // The replacement text
}

export async function applyTextEdits(
  targetApp: string | null, 
  edits: TextEdit[]
): Promise<{ success: boolean; appliedCount: number; errors: string[] }> {
  const errors: string[] = [];
  let appliedCount = 0;
  
  console.log('[TextEdit] Applying', edits.length, 'edit(s) to', targetApp);
  
  // Ensure target app is focused
  if (targetApp && targetApp !== 'Electron' && targetApp !== 'Faria') {
    await runAppleScript(`tell application "${targetApp}" to activate`);
    await cliclick.sleep(300);
  } else {
    console.log('[TextEdit] WARNING: No target app to activate');
  }
  
  try {
    // The text should still be selected from when we copied it
    // Combine all edits into the final text (in case there are multiple)
    // For simplicity, we'll just use the final newText from the last edit
    // (typically there's only one edit that replaces the entire selection)
    
    if (edits.length === 0) {
      return { success: true, appliedCount: 0, errors: [] };
    }
    
    const finalText = edits[edits.length - 1].newText;
    if (!finalText) {
      errors.push('Replacement text is empty');
      return { success: false, appliedCount: 0, errors };
    }
    
    // Save and set clipboard
    const savedClipboard = clipboard.readText();
    clipboard.writeText(finalText);
    await cliclick.sleep(100);
    
    // Paste via Edit menu
    const menuScript = `
      tell application "System Events"
        tell process "${targetApp}"
          click menu item "Paste" of menu "Edit" of menu bar 1
        end tell
      end tell
    `;
    await runAppleScript(menuScript);
    await cliclick.sleep(200);
    
    // Restore clipboard
    setTimeout(() => clipboard.writeText(savedClipboard), 500);
    
    appliedCount = edits.length;
    console.log('[TextEdit] Done');
  } catch (e) {
    console.log('[TextEdit] Error:', e);
    errors.push(`Failed to apply edits: ${e}`);
  }
  
  return {
    success: errors.length === 0,
    appliedCount,
    errors
  };
}

/**
 * Alternative: Apply edits using direct selection
 * Better for apps that don't have Cmd+F (like some text fields)
 */
export async function applyTextEditsDirectSelection(
  targetApp: string | null,
  contextText: string,
  edits: TextEdit[]
): Promise<{ success: boolean; appliedCount: number; errors: string[] }> {
  const errors: string[] = [];
  let appliedCount = 0;
  
  // Calculate what the final text should look like
  let newText = contextText;
  for (const edit of edits) {
    newText = newText.replace(edit.oldText, edit.newText);
  }
  
  // If no changes needed
  if (newText === contextText) {
    return { success: true, appliedCount: 0, errors: [] };
  }
  
  // Ensure target app is focused
  if (targetApp && targetApp !== 'Electron' && targetApp !== 'Faria') {
    await runAppleScript(`tell application "${targetApp}" to activate`);
    await cliclick.sleep(100);
  }
  
  try {
    // Select all the context text (we extracted it earlier, now select it again)
    // Go back to the start of what we extracted
    for (let i = 0; i < 60; i++) {
      await sendHotkeyAS(['option'], 'arrow-left');
      await cliclick.sleep(5);
    }
    
    // Select forward to cover all the context
    const wordCount = contextText.split(/\s+/).length;
    for (let i = 0; i < wordCount + 10; i++) {
      await sendHotkeyAS(['option', 'shift'], 'arrow-right');
      await cliclick.sleep(5);
    }
    
    // Type the replacement
    await cliclick.sendKeystrokes(newText);
    appliedCount = edits.length;
  } catch (e) {
    errors.push(`Failed to apply direct edit: ${e}`);
  }
  
  return {
    success: errors.length === 0,
    appliedCount,
    errors
  };
}

/**
 * Insert an image from URL into the current cursor position
 * Downloads the image, copies to clipboard, and pastes
 */
export async function insertImageFromUrl(
  targetApp: string | null,
  imageUrl: string
): Promise<{ success: boolean; error?: string }> {
  console.log('[InsertImage] Inserting to', targetApp);
  
  try {
    // Download image
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return { success: false, error: `Failed to fetch image: ${response.status}` };
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const { nativeImage } = require('electron');
    const image = nativeImage.createFromBuffer(buffer);
    
    if (image.isEmpty()) {
      return { success: false, error: 'Failed to create image from buffer' };
    }
    
    clipboard.writeImage(image);
    
    // Focus target app
    if (targetApp && targetApp !== 'Electron' && targetApp !== 'Faria') {
      await runAppleScript(`tell application "${targetApp}" to activate`);
      await cliclick.sleep(300);
    }
    
    // Paste via Edit menu
    const menuScript = `
      tell application "System Events"
        tell process "${targetApp}"
          click menu item "Paste" of menu "Edit" of menu bar 1
        end tell
      end tell
    `;
    await runAppleScript(menuScript);
    await cliclick.sleep(200);
    
    console.log('[InsertImage] Done');
    return { success: true };
  } catch (e) {
    console.log('[InsertImage] Error:', e);
    return { success: false, error: String(e) };
  }
}

