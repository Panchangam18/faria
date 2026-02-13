import { exec } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

// Anthropic vision constraints — images exceeding these are auto-downscaled by the API.
// We pre-resize to fit within these limits so we know the exact dimensions Claude sees,
// enabling deterministic coordinate conversion.
const MAX_LONG_EDGE = 1568;
const MAX_TOTAL_PIXELS = 1_180_000; // Stay safely under Anthropic's ~1.19MP threshold

/**
 * Calculate the target width for resizing a screenshot.
 * Applies both Anthropic's constraints: max long edge AND max total pixels.
 * Returns the target width (aspect ratio is preserved by sips).
 */
export function calculateResizeWidth(width: number, height: number): number {
  // Scale factor for long edge constraint
  const longEdgeScale = MAX_LONG_EDGE / Math.max(width, height);
  // Scale factor for total pixel constraint
  const totalPixelScale = Math.sqrt(MAX_TOTAL_PIXELS / (width * height));
  // Take the more restrictive constraint (but don't upscale)
  const scale = Math.min(1.0, longEdgeScale, totalPixelScale);

  return Math.round(width * scale);
}

/**
 * Resize an image using sips (built into macOS)
 * Maintains aspect ratio, fits within Anthropic's vision constraints.
 */
async function resizeImage(inputPath: string, outputPath: string): Promise<void> {
  // Get current dimensions
  const { stdout: dimensions } = await execAsync(
    `sips -g pixelWidth -g pixelHeight "${inputPath}" | tail -2 | awk '{print $2}'`
  );
  const [width, height] = dimensions.trim().split('\n').map(Number);

  const targetWidth = calculateResizeWidth(width, height);

  if (targetWidth < width) {
    await execAsync(`sips --resampleWidth ${targetWidth} "${inputPath}" --out "${outputPath}"`, { timeout: 10000 });
  } else {
    // Already small enough
    await execAsync(`cp "${inputPath}" "${outputPath}"`);
  }
}

export interface ScreenshotOptions {
  /** If true, skip resizing to preserve exact pixel coordinates for computer use */
  preserveSize?: boolean;
  /**
   * Which model provider will receive this screenshot.
   * - 'anthropic': resize to fit within Anthropic's vision constraints for deterministic coord mapping
   * - 'google': preserve full resolution (Gemini uses 0-1000 normalized coords, unaffected by image size)
   * - null/undefined: resize to save tokens (default)
   */
  provider?: 'anthropic' | 'google' | null;
}

/**
 * Capture a screenshot of the entire screen
 * Returns base64 encoded PNG
 *
 * @param options.preserveSize - If true, don't resize (important for computer use coordinate accuracy)
 */
export async function takeScreenshot(options: ScreenshotOptions = {}): Promise<string> {
  const tempPath = join(tmpdir(), `faria-screenshot-${uuidv4()}.png`);
  const resizedPath = join(tmpdir(), `faria-screenshot-${uuidv4()}-resized.png`);

  try {
    // Use screencapture command (built into macOS)
    await execAsync(`screencapture -x -t png "${tempPath}"`, {
      timeout: 5000,
    });

    // For Google/Gemini: preserve full resolution for best coordinate accuracy
    // (Gemini uses 0-1000 normalized coords, unaffected by image size)
    if (options.preserveSize || options.provider === 'google') {
      const imageBuffer = await readFile(tempPath);
      const base64 = imageBuffer.toString('base64');
      await unlink(tempPath).catch(() => {});
      return `data:image/png;base64,${base64}`;
    }

    // For Anthropic and default: resize to fit within vision constraints
    // This ensures deterministic coordinate mapping for Anthropic,
    // and saves tokens for non-agent uses.
    await resizeImage(tempPath, resizedPath);

    // Read the resized file and convert to base64
    const imageBuffer = await readFile(resizedPath);
    const base64 = imageBuffer.toString('base64');

    // Clean up temp files
    await unlink(tempPath).catch(() => {});
    await unlink(resizedPath).catch(() => {});

    return `data:image/png;base64,${base64}`;
  } catch (error) {
    // Clean up temp files on error
    await unlink(tempPath).catch(() => {});
    await unlink(resizedPath).catch(() => {});
    throw new Error(`Screenshot failed: ${(error as Error).message}`);
  }
}

/**
 * Capture a screenshot of a specific region
 */
export async function takeRegionScreenshot(
  x: number,
  y: number,
  width: number,
  height: number
): Promise<string> {
  const tempPath = join(tmpdir(), `faria-screenshot-${uuidv4()}.png`);
  
  try {
    // Use screencapture with region
    // Format: -R x,y,width,height
    await execAsync(
      `screencapture -x -t png -R ${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)} "${tempPath}"`,
      { timeout: 5000 }
    );
    
    const imageBuffer = await readFile(tempPath);
    const base64 = imageBuffer.toString('base64');
    
    await unlink(tempPath).catch(() => {});
    
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw new Error(`Region screenshot failed: ${(error as Error).message}`);
  }
}

/**
 * Capture a screenshot of a specific window
 */
export async function takeWindowScreenshot(windowId?: number): Promise<string> {
  const tempPath = join(tmpdir(), `faria-screenshot-${uuidv4()}.png`);
  
  try {
    let cmd: string;
    
    if (windowId) {
      // Capture specific window by ID
      cmd = `screencapture -x -t png -l ${windowId} "${tempPath}"`;
    } else {
      // Capture front window
      cmd = `screencapture -x -t png -w "${tempPath}"`;
    }
    
    await execAsync(cmd, { timeout: 5000 });
    
    const imageBuffer = await readFile(tempPath);
    const base64 = imageBuffer.toString('base64');
    
    await unlink(tempPath).catch(() => {});
    
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw new Error(`Window screenshot failed: ${(error as Error).message}`);
  }
}

/**
 * Get the dimensions of the screen
 */
export async function getScreenDimensions(): Promise<{ width: number; height: number }> {
  try {
    const { stdout } = await execAsync(
      `system_profiler SPDisplaysDataType | grep Resolution | head -1 | awk '{print $2, $4}'`
    );
    const [width, height] = stdout.trim().split(' ').map(Number);
    return { width, height };
  } catch {
    // Default fallback
    return { width: 1920, height: 1080 };
  }
}

