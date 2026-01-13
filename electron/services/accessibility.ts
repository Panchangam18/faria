import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runAppleScript, getFrontmostApp, escapeForAppleScript } from './applescript';

const execAsync = promisify(exec);

/**
 * Run AppleScript from a temp file to avoid shell escaping issues
 */
async function runAppleScriptSafe(script: string): Promise<string> {
  const tmpFile = join(tmpdir(), `faria-ax-${Date.now()}.scpt`);
  try {
    console.log('[AX] Writing script to', tmpFile, '- length:', script.length, 'content:', script.substring(0, 100));
    writeFileSync(tmpFile, script, 'utf-8');
    const { stdout } = await execAsync(`osascript "${tmpFile}"`, { timeout: 5000 });
    return stdout.trim();
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

export interface AccessibilityElement {
  id: number;
  role: string;
  title?: string;
  value?: string;
  description?: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  enabled?: boolean;
  focused?: boolean;
  children?: AccessibilityElement[];
}

export interface AccessibilityState {
  appName: string;
  bundleId?: string;
  focusedElement?: AccessibilityElement;
  elements: AccessibilityElement[];
  windowTitle?: string;
}

/**
 * Get the position of the text cursor on screen
 * Simple approach: get focused element role and position
 */
export async function getTextCursorPosition(): Promise<{ x: number; y: number } | null> {
  try {
    const lines = [
      'tell application "System Events"',
      'tell (first process whose frontmost is true)',
      'set f to focused UI element',
      'set r to role of f',
      'if r is "AXTextField" or r is "AXTextArea" or r is "AXComboBox" or r is "AXWebArea" or r is "AXScrollArea" then',
      'set p to position of f',
      'return (item 1 of p) & "," & (item 2 of p)',
      'end if',
      'end tell',
      'end tell',
      'return ""'
    ];
    const script = lines.join('\n');
    
    const result = await runAppleScriptSafe(script);
    if (result && result.includes(',')) {
      const [x, y] = result.split(',').map(Number);
      if (!isNaN(x) && !isNaN(y)) {
        console.log('[Accessibility] Text cursor detected at:', x, y);
        return { x, y };
      }
    }
    return null;
  } catch (e) {
    console.log('[Accessibility] getTextCursorPosition error:', e);
    return null;
  }
}

/**
 * Simpler check: just detect if we're in a text-editable context
 * Returns cursor position if in text, null otherwise
 */
export async function isInTextEditContext(): Promise<{ x: number; y: number } | null> {
  try {
    const lines = [
      'tell application "System Events"',
      'tell (first process whose frontmost is true)',
      'try',
      'set f to focused UI element',
      'set p to position of f',
      'return (item 1 of p) & "," & (item 2 of p)',
      'end try',
      'end tell',
      'end tell',
      'return ""'
    ];
    const script = lines.join('\n');
    
    const result = await runAppleScriptSafe(script);
    if (result && result.includes(',')) {
      const [x, y] = result.split(',').map(Number);
      if (!isNaN(x) && !isNaN(y)) {
        console.log('[Accessibility] Focused element at:', x, y);
        return { x, y };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract UI state using accessibility APIs via AppleScript
 * This is a more reliable method that works across most macOS apps
 */
export async function extractViaAccessibility(): Promise<AccessibilityState> {
  const appName = await getFrontmostApp();
  
  // Get basic window and element info
  const script = `
    tell application "System Events"
      set frontProcess to first process whose frontmost is true
      set processName to name of frontProcess
      
      -- Get window info
      set windowInfo to ""
      try
        set frontWindow to front window of frontProcess
        set windowTitle to name of frontWindow
        set windowInfo to windowTitle
      end try
      
      -- Get focused element info
      set focusedInfo to ""
      try
        set focusedUI to focused UI element of frontProcess
        set focusedRole to role of focusedUI
        set focusedTitle to ""
        try
          set focusedTitle to title of focusedUI
        end try
        set focusedValue to ""
        try
          set focusedValue to value of focusedUI
        end try
        set focusedInfo to focusedRole & "|" & focusedTitle & "|" & focusedValue
      end try
      
      -- Get UI element tree (limited depth)
      set elementsInfo to ""
      try
        set allElements to entire contents of front window of frontProcess
        set elementCount to 0
        repeat with elem in allElements
          if elementCount < 50 then
            try
              set elemRole to role of elem
              set elemTitle to ""
              try
                set elemTitle to title of elem
              end try
              set elemValue to ""
              try
                set elemValue to value of elem
              end try
              set elemPos to ""
              try
                set elemPosition to position of elem
                set elemPos to (item 1 of elemPosition as text) & "," & (item 2 of elemPosition as text)
              end try
              
              if elemTitle is not "" or elemValue is not "" then
                set elementsInfo to elementsInfo & elementCount & ":" & elemRole & ":" & elemTitle & ":" & elemValue & ":" & elemPos & "\\n"
                set elementCount to elementCount + 1
              end if
            end try
          end if
        end repeat
      end try
      
      return processName & "|||" & windowInfo & "|||" & focusedInfo & "|||" & elementsInfo
    end tell
  `;
  
  try {
    const result = await runAppleScript(script);
    return parseAccessibilityResult(result, appName);
  } catch (error) {
    // Return minimal state if accessibility fails
    return {
      appName,
      elements: [],
    };
  }
}

/**
 * Parse the AppleScript accessibility result
 */
function parseAccessibilityResult(result: string, appName: string): AccessibilityState {
  const parts = result.split('|||');
  const elements: AccessibilityElement[] = [];
  
  const windowTitle = parts[1] || undefined;
  
  // Parse focused element
  let focusedElement: AccessibilityElement | undefined;
  if (parts[2]) {
    const [role, title, value] = parts[2].split('|');
    if (role) {
      focusedElement = {
        id: 0,
        role,
        title: title || undefined,
        value: value || undefined,
        focused: true,
      };
    }
  }
  
  // Parse element tree
  if (parts[3]) {
    const lines = parts[3].split('\\n').filter(Boolean);
    lines.forEach((line, index) => {
      const [idStr, role, title, value, pos] = line.split(':');
      const id = parseInt(idStr, 10) || index + 1;
      
      const element: AccessibilityElement = {
        id,
        role: role || 'unknown',
        title: title || undefined,
        value: value || undefined,
      };
      
      if (pos) {
        const [x, y] = pos.split(',').map(Number);
        if (!isNaN(x) && !isNaN(y)) {
          element.position = { x, y };
        }
      }
      
      elements.push(element);
    });
  }
  
  return {
    appName,
    windowTitle,
    focusedElement,
    elements,
  };
}

/**
 * Check if the current app has useful accessibility tree
 */
export function isUsefulTree(state: AccessibilityState): boolean {
  // Consider it useful if we have at least a few interactive elements
  return state.elements.length >= 3 || state.focusedElement !== undefined;
}

/**
 * Format accessibility state for agent context
 */
export function formatAccessibilityState(state: AccessibilityState): string {
  const lines: string[] = [];
  
  lines.push(`App: ${state.appName}`);
  if (state.windowTitle) {
    lines.push(`Window: ${state.windowTitle}`);
  }
  
  if (state.focusedElement) {
    const fe = state.focusedElement;
    let focusedLine = `Focused: ${fe.role}`;
    if (fe.title) focusedLine += ` "${fe.title}"`;
    if (fe.value) focusedLine += ` value="${fe.value.slice(0, 100)}"`;
    lines.push(focusedLine);
  }
  
  if (state.elements.length > 0) {
    lines.push('');
    lines.push('Elements in view:');
    state.elements.forEach((elem) => {
      let line = `[${elem.id}] ${elem.role}`;
      if (elem.title) line += ` "${elem.title}"`;
      if (elem.value) line += ` value="${elem.value.slice(0, 50)}"`;
      if (elem.position) line += ` (${elem.position.x}, ${elem.position.y})`;
      lines.push(line);
    });
  }
  
  return lines.join('\n');
}

/**
 * Get accessibility element by ID
 */
export function getElementById(
  state: AccessibilityState,
  id: number
): AccessibilityElement | undefined {
  return state.elements.find((e) => e.id === id);
}

/**
 * Debug function: get info about the currently focused element
 */
export async function debugFocusedElement(): Promise<string> {
  try {
    const lines = [
      'tell application "System Events"',
      'tell (first process whose frontmost is true)',
      'try',
      'set f to focused UI element',
      'set r to role of f',
      'return r',
      'on error e',
      'return e',
      'end try',
      'end tell',
      'end tell'
    ];
    const script = lines.join('\n');
    
    return await runAppleScriptSafe(script);
  } catch (e) {
    return `Exception: ${e}`;
  }
}

