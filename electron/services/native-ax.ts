import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

// Types matching Swift output
export interface NativeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NativeElement {
  id: number;
  role: string;
  label?: string;
  value?: string;
  rect?: NativeRect;
  enabled: boolean;
  focused: boolean;
}

export interface NativeExtractionResult {
  success: boolean;
  app: string;
  bundleId?: string;
  windowTitle?: string;
  focusedElement?: NativeElement;
  elements: NativeElement[];
  error?: string;
}

/**
 * Get the path to the native ax-extract binary
 */
function getAxExtractPath(): string {
  // In development, use the native directory
  if (!app.isPackaged) {
    return path.join(__dirname, '..', '..', 'native', 'ax-extract');
  }
  // In production, use the resources directory
  return path.join(process.resourcesPath, 'native', 'ax-extract');
}

/**
 * Extract UI state using native macOS accessibility APIs
 * This is the primary extraction method - fast and reliable
 */
export async function extractViaNativeAX(): Promise<NativeExtractionResult> {
  try {
    const axPath = getAxExtractPath();
    const { stdout } = await execFileAsync(axPath, [], { timeout: 5000 });
    return JSON.parse(stdout) as NativeExtractionResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      app: 'Unknown',
      elements: [],
      error: `Native extraction failed: ${message}`,
    };
  }
}

/**
 * Format native extraction result for agent context
 * All elements with coordinates are clickable - in web apps, anything can be a click target
 */
export function formatNativeState(result: NativeExtractionResult): string {
  const lines: string[] = [];

  lines.push(`App: ${result.app}`);
  if (result.windowTitle) {
    lines.push(`Window: ${result.windowTitle}`);
  }

  // Show focused element
  if (result.focusedElement) {
    const fe = result.focusedElement;
    let focusLine = `Focused: ${fe.role}`;
    if (fe.label) focusLine += ` "${fe.label}"`;
    if (fe.value) focusLine += ` value="${fe.value.slice(0, 100)}"`;
    lines.push(focusLine);
  }

  // All elements are potentially clickable - show them all with IDs
  if (result.elements.length > 0) {
    lines.push('');
    lines.push('Elements (click by ID):');
    for (const elem of result.elements) {
      const label = elem.label || elem.value || '';
      const truncLabel = label.length > 50 ? label.slice(0, 50) + '...' : label;

      let line = `[${elem.id}] ${elem.role}`;
      if (truncLabel) line += ` "${truncLabel}"`;
      if (elem.rect) line += ` @(${elem.rect.x},${elem.rect.y})`;
      if (!elem.enabled) line += ' [disabled]';
      lines.push(line);
    }
  }

  return lines.join('\n');
}

/**
 * Get element coordinates by ID
 */
export function getElementById(result: NativeExtractionResult, id: number): { x: number; y: number } | null {
  const elem = result.elements.find(e => e.id === id);
  if (elem?.rect) {
    return {
      x: elem.rect.x + elem.rect.w / 2,
      y: elem.rect.y + elem.rect.h / 2,
    };
  }
  return null;
}

/**
 * Check if extraction result has useful web content
 * For browsers, we need actual page elements (links, headings, inputs), not just browser chrome
 */
export function hasUsefulContent(result: NativeExtractionResult): boolean {
  if (!result.success) return false;

  // Check for web content indicators - elements that suggest actual page content
  const webContentRoles = ['Link', 'Heading', 'ComboBox', 'TextField', 'TextArea', 'List'];
  const hasWebContent = result.elements.some(e => webContentRoles.includes(e.role));

  // Also check for enough StaticText elements (page text)
  const staticTextCount = result.elements.filter(e => e.role === 'StaticText').length;

  // Consider useful if we have web content OR plenty of text
  return hasWebContent || staticTextCount >= 5 || result.elements.length >= 15;
}
