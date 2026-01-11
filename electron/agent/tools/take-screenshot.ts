import { ToolResult } from './types';
import { takeScreenshot } from '../../services/screenshot';

export async function takeScreenshotTool(): Promise<ToolResult> {
  const screenshot = await takeScreenshot();
  return { success: true, result: screenshot };
}

