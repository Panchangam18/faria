import { getFrontmostApp, getAppBundleId } from './applescript';
import { extractViaJSInjection, isBrowser, getBrowserType, formatBrowserState, BrowserState } from './js-injection';
import { extractViaAppleScript, hasAppleScriptDictionary, formatAppleScriptState, AppleScriptState } from './applescript-extraction';
import { extractViaAccessibility, isUsefulTree, formatAccessibilityState, AccessibilityState } from './accessibility';
import { takeScreenshot } from './screenshot';
import { AppRegistry } from './app-registry';

export type ExtractionTier = 1 | 2 | 3 | 4;
export type ExtractionMethod = 'js_injection' | 'applescript' | 'accessibility' | 'screenshot';

export interface AppState {
  tier: ExtractionTier;
  method: ExtractionMethod;
  appName: string;
  bundleId?: string;
  browserState?: BrowserState;
  appleScriptState?: AppleScriptState;
  accessibilityState?: AccessibilityState;
  screenshot?: string;
  formatted: string;
  timestamp: number;
}

export class StateExtractor {
  private appRegistry: AppRegistry;
  
  constructor(appRegistry: AppRegistry) {
    this.appRegistry = appRegistry;
  }
  
  /**
   * Extract state from the currently focused application
   * Uses tiered approach: JS Injection → AppleScript → Accessibility → Screenshot
   */
  async extractState(): Promise<AppState> {
    const appName = await getFrontmostApp();
    const bundleId = await getAppBundleId(appName) || undefined;
    const timestamp = Date.now();
    
    // Tier 1: JavaScript injection for browsers
    if (isBrowser(appName)) {
      const browserType = getBrowserType(appName);
      if (browserType) {
        // extractViaJSInjection handles its own error logging gracefully
        const browserState = await extractViaJSInjection(browserType);
        if (browserState && browserState.elements.length > 0) {
          return {
            tier: 1,
            method: 'js_injection',
            appName,
            bundleId,
            browserState,
            formatted: formatBrowserState(browserState),
            timestamp,
          };
        }
        // Falls through to other tiers if JS injection returns null or no elements
      }
    }
    
    // Tier 2: AppleScript for apps with rich dictionaries
    if (await hasAppleScriptDictionary(appName)) {
      try {
        const asState = await extractViaAppleScript(appName);
        if (asState) {
          return {
            tier: 2,
            method: 'applescript',
            appName,
            bundleId,
            appleScriptState: asState,
            formatted: formatAppleScriptState(asState),
            timestamp,
          };
        }
      } catch (error) {
        console.error('AppleScript extraction failed, falling through:', error);
      }
    }
    
    // Tier 3: Accessibility API (universal fallback)
    try {
      const axState = await extractViaAccessibility();
      if (isUsefulTree(axState)) {
        return {
          tier: 3,
          method: 'accessibility',
          appName,
          bundleId,
          accessibilityState: axState,
          formatted: formatAccessibilityState(axState),
          timestamp,
        };
      }
      
      // Tier 4: Screenshot (last resort)
      // Include accessibility data even if not useful, plus screenshot
      const screenshot = await takeScreenshot();
      return {
        tier: 4,
        method: 'screenshot',
        appName,
        bundleId,
        accessibilityState: axState,
        screenshot,
        formatted: `App: ${appName}\n[Screenshot provided - visual analysis required]`,
        timestamp,
      };
    } catch (error) {
      console.error('Accessibility extraction failed:', error);
      
      // Last resort: just screenshot
      const screenshot = await takeScreenshot();
      return {
        tier: 4,
        method: 'screenshot',
        appName,
        bundleId,
        screenshot,
        formatted: `App: ${appName}\n[Screenshot provided - visual analysis required]`,
        timestamp,
      };
    }
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
    lines.push(`Extraction Method: Tier ${state.tier} (${state.method})`);
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
    
    // Check accessibility state
    if (state.accessibilityState) {
      const elem = state.accessibilityState.elements.find(e => e.id === id);
      if (elem && elem.position) {
        return {
          x: elem.position.x,
          y: elem.position.y,
        };
      }
    }
    
    return null;
  }
}

