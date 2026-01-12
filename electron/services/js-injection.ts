import { executeJavaScriptInBrowser, escapeForAppleScript } from './applescript';

export interface BrowserElement {
  id: number;
  tag: string;
  text?: string;
  role?: string;
  rect: { x: number; y: number; w: number; h: number };
  href?: string;
  type?: string;
  placeholder?: string;
}

export interface BrowserState {
  url: string;
  title: string;
  selectedText?: string;
  cursorPosition?: number;
  focusedElement?: string;
  focusedElementValue?: string;
  elements: BrowserElement[];
  documentText?: string;
}

/**
 * The JavaScript code to inject into browsers for state extraction
 */
const EXTRACTION_SCRIPT = `
(function() {
  try {
    const selection = window.getSelection();
    const activeEl = document.activeElement;
    
    // Get cursor position in text inputs
    let cursorPosition = null;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
      cursorPosition = activeEl.selectionStart;
    }
    
    // Get focused element value
    let focusedValue = null;
    if (activeEl) {
      focusedValue = activeEl.value || activeEl.textContent?.slice(0, 500);
    }
    
    // Get interactive elements in viewport
    const elements = [];
    const selectors = 'button, input, textarea, a, [role="button"], [role="link"], [role="textbox"], [onclick], select';
    
    document.querySelectorAll(selectors).forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      
      // Only include elements in viewport
      if (rect.top >= -50 && rect.top <= window.innerHeight + 50 &&
          rect.left >= -50 && rect.left <= window.innerWidth + 50 &&
          rect.width > 0 && rect.height > 0) {
        
        const element = {
          id: elements.length + 1,
          tag: el.tagName,
          text: (el.textContent || el.value || '').slice(0, 100).trim(),
          role: el.getAttribute('role'),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
          }
        };
        
        // Add href for links
        if (el.tagName === 'A') {
          element.href = el.href;
        }
        
        // Add type and placeholder for inputs
        if (el.tagName === 'INPUT') {
          element.type = el.type;
          element.placeholder = el.placeholder;
        }
        
        elements.push(element);
      }
    });
    
    // Get some document text context around selection
    let documentText = null;
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      if (container) {
        const parent = container.nodeType === 3 ? container.parentElement : container;
        if (parent) {
          documentText = parent.textContent?.slice(0, 1000);
        }
      }
    }
    
    return JSON.stringify({
      url: location.href,
      title: document.title,
      selectedText: selection?.toString() || null,
      cursorPosition: cursorPosition,
      focusedElement: activeEl?.tagName || null,
      focusedElementValue: focusedValue,
      elements: elements.slice(0, 100),
      documentText: documentText
    });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
})()
`;

// Track browsers that have shown permission errors to avoid spamming logs
const browserPermissionWarned = new Set<string>();

/**
 * Check if error is a Safari JavaScript permission error
 */
function isSafariPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Allow JavaScript from Apple Events") || 
         message.includes("do JavaScript");
}

/**
 * Extract state from a browser via JavaScript injection
 */
export async function extractViaJSInjection(
  browser: 'Safari' | 'Google Chrome' | 'Arc'
): Promise<BrowserState | null> {
  try {
    const result = await executeJavaScriptInBrowser(browser, EXTRACTION_SCRIPT);
    
    if (!result) {
      return null;
    }
    
    const parsed = JSON.parse(result);
    
    if (parsed.error) {
      console.error('Browser JS extraction error:', parsed.error);
      return null;
    }
    
    return parsed as BrowserState;
  } catch (error) {
    // Handle Safari's JavaScript permission requirement gracefully
    if (browser === 'Safari' && isSafariPermissionError(error)) {
      if (!browserPermissionWarned.has(browser)) {
        console.warn(
          '[Faria] Safari JS injection unavailable - enable "Allow JavaScript from Apple Events" in Safari > Settings > Developer to enable rich browser state. Falling back to accessibility/screenshot methods.'
        );
        browserPermissionWarned.add(browser);
      }
      return null;
    }
    
    console.error('Failed to extract state via JS injection:', error);
    return null;
  }
}

/**
 * Execute arbitrary JavaScript in a browser
 */
export async function executeInBrowser(
  browser: 'Safari' | 'Google Chrome' | 'Arc',
  code: string
): Promise<string> {
  return executeJavaScriptInBrowser(browser, code);
}

/**
 * Format browser state for agent context
 */
export function formatBrowserState(state: BrowserState): string {
  const lines: string[] = [];
  
  lines.push(`URL: ${state.url}`);
  lines.push(`Title: ${state.title}`);
  
  if (state.selectedText) {
    lines.push(`Selected: "${state.selectedText.slice(0, 200)}"`);
  }
  
  if (state.focusedElement) {
    let focusedLine = `Focused: ${state.focusedElement}`;
    if (state.cursorPosition !== undefined && state.cursorPosition !== null) {
      focusedLine += ` cursor_pos=${state.cursorPosition}`;
    }
    if (state.focusedElementValue) {
      focusedLine += ` value="${state.focusedElementValue.slice(0, 100)}"`;
    }
    lines.push(focusedLine);
  }
  
  if (state.documentText) {
    lines.push('');
    lines.push('Context:');
    lines.push(state.documentText.slice(0, 500));
  }
  
  if (state.elements.length > 0) {
    lines.push('');
    lines.push('Interactive elements:');
    state.elements.forEach((elem) => {
      let line = `[${elem.id}] ${elem.tag}`;
      if (elem.role) line += `[role=${elem.role}]`;
      if (elem.text) line += ` "${elem.text.slice(0, 50)}"`;
      if (elem.type) line += ` type=${elem.type}`;
      if (elem.placeholder) line += ` placeholder="${elem.placeholder}"`;
      line += ` (${elem.rect.x},${elem.rect.y})`;
      lines.push(line);
    });
  }
  
  return lines.join('\n');
}

/**
 * Check if we're dealing with a supported browser
 */
export function isBrowser(appName: string): boolean {
  const browsers = ['Safari', 'Google Chrome', 'Arc', 'Chromium', 'Brave Browser', 'Microsoft Edge'];
  return browsers.some(b => appName.toLowerCase().includes(b.toLowerCase()));
}

/**
 * Get browser type from app name
 */
export function getBrowserType(appName: string): 'Safari' | 'Google Chrome' | 'Arc' | null {
  const name = appName.toLowerCase();
  
  if (name.includes('safari')) return 'Safari';
  if (name.includes('chrome') || name.includes('chromium') || name.includes('brave') || name.includes('edge')) {
    return 'Google Chrome';
  }
  if (name.includes('arc')) return 'Arc';
  
  return null;
}

