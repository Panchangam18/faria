import { exec } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

// Max dimension for screenshots to reduce token usage (Claude vision handles this well)
const MAX_SCREENSHOT_DIMENSION = 1568;

/**
 * Resize an image using sips (built into macOS)
 * Maintains aspect ratio, resizes to fit within maxDimension
 */
async function resizeImage(inputPath: string, outputPath: string, maxDimension: number): Promise<void> {
  // Get current dimensions
  const { stdout: dimensions } = await execAsync(
    `sips -g pixelWidth -g pixelHeight "${inputPath}" | tail -2 | awk '{print $2}'`
  );
  const [width, height] = dimensions.trim().split('\n').map(Number);
  
  // Only resize if larger than max dimension
  if (width > maxDimension || height > maxDimension) {
    // Determine which dimension to constrain
    if (width >= height) {
      await execAsync(`sips --resampleWidth ${maxDimension} "${inputPath}" --out "${outputPath}"`, { timeout: 10000 });
    } else {
      await execAsync(`sips --resampleHeight ${maxDimension} "${inputPath}" --out "${outputPath}"`, { timeout: 10000 });
    }
  } else {
    // Just copy if already small enough
    await execAsync(`cp "${inputPath}" "${outputPath}"`);
  }
}

/**
 * Capture a screenshot of the entire screen
 * Returns base64 encoded PNG, resized to reduce token usage
 */
export async function takeScreenshot(): Promise<string> {
  const tempPath = join(tmpdir(), `faria-screenshot-${uuidv4()}.png`);
  const resizedPath = join(tmpdir(), `faria-screenshot-${uuidv4()}-resized.png`);
  
  try {
    // Use screencapture command (built into macOS)
    await execAsync(`screencapture -x -t png "${tempPath}"`, {
      timeout: 5000,
    });
    
    // Resize to reduce token usage
    await resizeImage(tempPath, resizedPath, MAX_SCREENSHOT_DIMENSION);
    
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

