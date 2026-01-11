import { ToolResult, ToolContext } from './types';
import { focusApp as focusAppAS } from '../../services/applescript';
import { click as cliClick, sleep } from '../../services/cliclick';

export interface ClickParams {
  target: string;
}

export async function click(
  params: ClickParams,
  context: ToolContext
): Promise<ToolResult> {
  const { target } = params;
  
  // Use the target app captured when command bar opened
  const appToTarget = context.targetApp;
  if (appToTarget && appToTarget !== 'Electron' && appToTarget !== 'Faria') {
    console.log(`[Faria] Activating "${appToTarget}" before clicking`);
    await focusAppAS(appToTarget);
    await sleep(300); // Wait for focus to switch
  }
  
  // Try to parse as element ID
  const elementId = parseInt(target, 10);
  if (!isNaN(elementId) && context.currentState) {
    const pos = context.stateExtractor.getElementById(context.currentState, elementId);
    if (pos) {
      await cliClick(pos.x, pos.y);
      return { success: true, result: `Clicked element [${elementId}] at (${pos.x}, ${pos.y})` };
    }
  }
  
  // Try to parse as coordinates
  try {
    const coords = JSON.parse(target);
    if (typeof coords.x === 'number' && typeof coords.y === 'number') {
      await cliClick(coords.x, coords.y);
      return { success: true, result: `Clicked at (${coords.x}, ${coords.y})` };
    }
  } catch {
    // Not JSON
  }
  
  return { success: false, error: `Invalid click target: ${target}` };
}

