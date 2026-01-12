import { getFrontmostApp } from './applescript';
import { extractViaNativeAX, formatNativeState, hasUsefulContent, NativeExtractionResult } from './native-ax';
import { extractViaJSInjection, isBrowser, getBrowserType, BrowserState } from './js-injection';
import { takeScreenshot } from './screenshot';
import { AppRegistry } from './app-registry';

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
  // Keep appRegistry for potential future use with app-specific extraction
  constructor(_appRegistry: AppRegistry) {
    // App registry available for future app-specific logic
  }

  /**
   * Extract state from the currently focused application
   * Uses native accessibility as primary method
   * No images - pure structured data
   */
  async extractState(): Promise<AppState> {
    const timestamp = Date.now();

    // Primary: Native accessibility extraction
    const nativeResult = await extractViaNativeAX();
    const appName = nativeResult.app;
    const bundleId = nativeResult.bundleId;

    // For browsers, we can optionally enhance with JS injection
    // but native AX already gives us good data
    if (isBrowser(appName) && hasUsefulContent(nativeResult)) {
      // Native AX works well for browsers too - use it
      return {
        method: 'native_ax',
        appName,
        bundleId,
        windowTitle: nativeResult.windowTitle,
        nativeState: nativeResult,
        formatted: formatNativeState(nativeResult),
        timestamp,
      };
    }

    // For browsers where native AX failed, try JS injection as fallback
    if (isBrowser(appName) && !hasUsefulContent(nativeResult)) {
      const browserType = getBrowserType(appName);
      if (browserType) {
        const browserState = await extractViaJSInjection(browserType);
        if (browserState && browserState.elements.length > 0) {
          return {
            method: 'js_injection',
            appName,
            bundleId,
            windowTitle: browserState.title,
            browserState,
            formatted: formatBrowserStateCompact(browserState),
            timestamp,
          };
        }
      }
    }

    // If we have useful native AX content, use it
    if (hasUsefulContent(nativeResult)) {
      return {
        method: 'native_ax',
        appName,
        bundleId,
        windowTitle: nativeResult.windowTitle,
        nativeState: nativeResult,
        formatted: formatNativeState(nativeResult),
        timestamp,
      };
    }

    // Last resort: screenshot fallback (for Electron apps, etc.)
    const screenshot = await takeScreenshot();
    return {
      method: 'screenshot',
      appName,
      bundleId,
      windowTitle: nativeResult.windowTitle,
      screenshot,
      formatted: `App: ${appName}\nWindow: ${nativeResult.windowTitle || 'Unknown'}\n\n[No structured UI data available - screenshot provided for visual context]`,
      timestamp,
    };
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

  /**
   * Get element by ID from state
   */
  getElementById(state: AppState, id: number): { x: number; y: number } | null {
    // Check native state
    if (state.nativeState) {
      const elem = state.nativeState.elements.find(e => e.id === id);
      if (elem?.rect) {
        return {
          x: elem.rect.x + elem.rect.w / 2,
          y: elem.rect.y + elem.rect.h / 2,
        };
      }
    }

    // Check browser state
    if (state.browserState) {
      const elem = state.browserState.elements.find(e => e.id === id);
      if (elem) {
        return {
          x: elem.rect.x + elem.rect.w / 2,
          y: elem.rect.y + elem.rect.h / 2,
        };
      }
    }

    return null;
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
    lines.push('Clickable:');
    // Limit to 30 most relevant elements
    const limited = state.elements.slice(0, 30);
    for (const elem of limited) {
      let line = `[${elem.id}] ${elem.tag}`;
      if (elem.text) line += ` "${elem.text.slice(0, 40)}"`;
      if (elem.type) line += ` type=${elem.type}`;
      line += ` @(${elem.rect.x},${elem.rect.y})`;
      lines.push(line);
    }
  }

  return lines.join('\n');
}
