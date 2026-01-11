import { ToolResult } from './types';
import { sendKeystrokes as cliSendKeystrokes, sendHotkey as cliSendHotkey, sleep } from '../../services/cliclick';

export interface FindReplaceParams {
  find: string;
  replace: string;
}

export async function findReplace(params: FindReplaceParams): Promise<ToolResult> {
  const { find, replace } = params;
  
  // Open Find & Replace dialog
  await cliSendHotkey(['cmd'], 'h');
  await sleep(200);
  
  // Type find text
  await cliSendKeystrokes(find);
  await sleep(50);
  
  // Tab to replace field
  await cliSendHotkey([], 'tab');
  await sleep(50);
  
  // Type replace text
  await cliSendKeystrokes(replace);
  await sleep(50);
  
  // Press Enter for Replace All
  await cliSendHotkey(['cmd'], 'return');
  await sleep(100);
  
  // Close dialog
  await cliSendHotkey([], 'escape');
  
  return { success: true, result: `Replaced "${find}" with "${replace}"` };
}

