import { exec } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile, unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

/**
 * Capture a screenshot of the entire screen
 * Returns base64 encoded PNG
 */
export async function takeScreenshot(): Promise<string> {
  const tempPath = join(tmpdir(), `faria-screenshot-${uuidv4()}.png`);
  
  try {
    // Use screencapture command (built into macOS)
    await execAsync(`screencapture -x -t png "${tempPath}"`, {
      timeout: 5000,
    });
    
    // Read the file and convert to base64
    const imageBuffer = await readFile(tempPath);
    const base64 = imageBuffer.toString('base64');
    
    // Clean up temp file
    await unlink(tempPath).catch(() => {});
    
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    // Clean up temp file on error
    await unlink(tempPath).catch(() => {});
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

