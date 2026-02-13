import { getFrontmostApp } from './applescript';
import { extractViaNativeAX, formatNativeState, hasUsefulContent, NativeExtractionResult } from './native-ax';
import { extractViaJSInjection, isBrowser, getBrowserType, BrowserState } from './js-injection';
import { takeScreenshot } from './screenshot';

export type ExtractionMethod = 'native_ax' | 'js_injection' | 'screenshot';

export interface AppState {
  method: ExtractionMethod;
  appName: string;
  bundleId?: string;
  windowTitle?: string;
  // Native AX state (primary)
  nativeState?: NativeExtractionResult;
  // Browser state (enhanced for web apps)
  browserState?: BrowserState;
  // Screenshot fallback (last resort for Electron apps, etc.)
  screenshot?: string;
  // Formatted text for agent
  formatted: string;
  timestamp: number;
}

export class StateExtractor {
  private provider: 'anthropic' | 'google' | null = null;

  constructor() {
    // State extractor initialization
  }

  /**
   * Set the model provider for screenshot sizing decisions.
   * Google/Gemini gets full-res screenshots (uses normalized coords).
   * Anthropic/Claude gets resized screenshots (for deterministic coord mapping).
   */
  setProvider(provider: 'anthropic' | 'google' | null): void {
    this.provider = provider;
  }

  /**
   * Extract state from the currently focused application
   * Uses native accessibility as primary method
   * No images - pure structured data
   * @param selectedText Optional user-selected text to include at top of state
   */
  async extractState(selectedText?: string): Promise<AppState> {
    const timestamp = Date.now();

    // Primary: Native accessibility extraction
    const nativeResult = await extractViaNativeAX();
    const appName = nativeResult.app;
    const bundleId = nativeResult.bundleId;

    let state: AppState;

    // For browsers, we can optionally enhance with JS injection
    // but native AX already gives us good data
    if (isBrowser(appName) && hasUsefulContent(nativeResult)) {
      // Native AX works well for browsers too - use it
      state = {
        method: 'native_ax',
        appName,
        bundleId,
        windowTitle: nativeResult.windowTitle,
        nativeState: nativeResult,
        formatted: formatNativeState(nativeResult),
        timestamp,
      };
    } else if (isBrowser(appName) && !hasUsefulContent(nativeResult)) {
      // For browsers where native AX failed, try JS injection as fallback
      const browserType = getBrowserType(appName);
      if (browserType) {
        const browserState = await extractViaJSInjection(browserType);
        if (browserState && browserState.elements.length > 0) {
          state = {
            method: 'js_injection',
            appName,
            bundleId,
            windowTitle: browserState.title,
            browserState,
            formatted: formatBrowserStateCompact(browserState),
            timestamp,
          };
        } else {
          // Fallback to screenshot
          const screenshot = await takeScreenshot({ provider: this.provider });
          state = {
            method: 'screenshot',
            appName,
            bundleId,
            windowTitle: nativeResult.windowTitle,
            screenshot,
            formatted: `App: ${appName}\nWindow: ${nativeResult.windowTitle || 'Unknown'}\n\n[No structured UI data available - screenshot provided for visual context]`,
            timestamp,
          };
        }
      } else {
        // Fallback to screenshot
        const screenshot = await takeScreenshot({ provider: this.provider });
        state = {
          method: 'screenshot',
          appName,
          bundleId,
          windowTitle: nativeResult.windowTitle,
          screenshot,
          formatted: `App: ${appName}\nWindow: ${nativeResult.windowTitle || 'Unknown'}\n\n[No structured UI data available - screenshot provided for visual context]`,
          timestamp,
        };
      }
    } else if (hasUsefulContent(nativeResult)) {
      // If we have useful native AX content, use it
      state = {
        method: 'native_ax',
        appName,
        bundleId,
        windowTitle: nativeResult.windowTitle,
        nativeState: nativeResult,
        formatted: formatNativeState(nativeResult),
        timestamp,
      };
    } else {
      // Last resort: screenshot fallback (for Electron apps, etc.)
      // Screenshot sizing depends on provider (set via setProvider)
      const screenshot = await takeScreenshot({ provider: this.provider });
      state = {
        method: 'screenshot',
        appName,
        bundleId,
        windowTitle: nativeResult.windowTitle,
        screenshot,
        formatted: `App: ${appName}\nWindow: ${nativeResult.windowTitle || 'Unknown'}\n\n[No structured UI data available - screenshot provided for visual context]`,
        timestamp,
      };
    }

    // If selected text is provided, prepend it to the formatted output
    if (selectedText) {
      const selectedPrefix = `=== USER SELECTED TEXT ===\n"${selectedText}"\n\nYou can replace this selected text by using computer_actions with type: "type" to type replacement text.\n\n`;
      state.formatted = selectedPrefix + state.formatted;
    }

    return state;
  }

  /**
   * Get the currently focused app name
   */
  async getFocusedApp(): Promise<string> {
    return getFrontmostApp();
  }

  /**
   * Format state for agent context prompt
   */
  formatForAgent(state: AppState): string {
    const lines: string[] = [];

    lines.push(`=== Current Application State ===`);
    lines.push('');
    lines.push(state.formatted);

    if (state.screenshot) {
      lines.push('');
      lines.push('[Screenshot attached for visual reference]');
    }

    return lines.join('\n');
  }

}

/**
 * Compact formatter for browser state (fallback only)
 */
function formatBrowserStateCompact(state: BrowserState): string {
  const lines: string[] = [];

  lines.push(`App: Browser`);
  lines.push(`URL: ${state.url}`);
  lines.push(`Title: ${state.title}`);

  if (state.focusedElement) {
    let focusedLine = `Focused: ${state.focusedElement}`;
    if (state.cursorPosition !== undefined && state.cursorPosition !== null) {
      focusedLine += ` cursor=${state.cursorPosition}`;
    }
    lines.push(focusedLine);
  }

  if (state.elements.length > 0) {
    lines.push('');
    lines.push('Elements:');
    // Limit to 30 most relevant elements
    const limited = state.elements.slice(0, 30);
    for (const elem of limited) {
      let line = `- ${elem.tag}`;
      if (elem.text) line += ` "${elem.text.slice(0, 40)}"`;
      if (elem.type) line += ` type=${elem.type}`;
      line += ` @(${elem.rect.x},${elem.rect.y})`;
      lines.push(line);
    }
  }

  return lines.join('\n');
}
