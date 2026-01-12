import { ToolResult, ToolContext } from './types';
import { focusApp as focusAppAS } from '../../services/applescript';
import { click as cliClick, sleep } from '../../services/cliclick';

export interface ClickParams {
  x: number;
  y: number;
}

export async function click(
  params: ClickParams,
  context: ToolContext
): Promise<ToolResult> {
  const { x, y } = params;

  // Validate coordinates
  if (typeof x !== 'number' || typeof y !== 'number') {
    return { success: false, error: 'Click requires x and y coordinates' };
  }

  // Use the target app captured when command bar opened
  const appToTarget = context.targetApp;
  if (appToTarget && appToTarget !== 'Electron' && appToTarget !== 'Faria') {
    console.log(`[Faria] Activating "${appToTarget}" before clicking`);
    await focusAppAS(appToTarget);
    await sleep(300); // Wait for focus to switch
  }

  await cliClick(x, y);
  return { success: true, result: `Clicked at (${x}, ${y})` };
}
