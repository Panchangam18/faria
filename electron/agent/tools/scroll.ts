import { ToolResult } from './types';
import { scroll as cliScroll } from '../../services/cliclick';

export interface ScrollParams {
  direction: 'up' | 'down' | 'left' | 'right';
  amount?: number;
}

export async function scroll(params: ScrollParams): Promise<ToolResult> {
  await cliScroll(params.direction, params.amount || 1);
  return { success: true, result: `Scrolled ${params.direction} ${params.amount || 1} page(s)` };
}

