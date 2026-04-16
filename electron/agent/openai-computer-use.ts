import OpenAI from 'openai';
import { clipboard, screen } from 'electron';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as cliclick from '../services/cliclick';
import { takeScreenshot } from '../services/screenshot';
import { runAppleScript } from '../services/applescript';
import { getOpenAIConfig } from '../services/proxy';

/**
 * OpenAI Responses API computer use loop.
 *
 * GPT-5.4 uses a dedicated "computer" tool type in the Responses API,
 * returning `computer_call` outputs with batched `actions[]` arrays.
 * This is fundamentally different from the Chat Completions tool-calling
 * pattern used by Anthropic and Google.
 *
 * Flow:
 *   1. Send task → model returns computer_call with actions[]
 *   2. Execute actions locally (cliclick, applescript, screencapture)
 *   3. Capture screenshot, send back as computer_call_output
 *   4. Repeat until model returns text (no computer_call)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ComputerAction = any; // OpenAI's action objects from computer_call

interface OpenAICUACallbacks {
  sendStatus: (status: string) => void;
  sendChunk: (chunk: string) => void;
  sendChunkClear: () => void;
  shouldCancel: () => boolean;
  requestApproval: (args: Record<string, unknown>) => Promise<{ approved: boolean; reason?: string }>;
  /** Execute a LangChain tool by name (handles approval + invocation). Returns result string. */
  executeFunction?: (toolName: string, args: Record<string, unknown>) => Promise<string>;
}

interface TraceAction {
  tool: string;
  input: unknown;
  timestamp: number;
}

export interface OpenAIComputerUseResult {
  response: string;
  toolsUsed: string[];
  actions: TraceAction[];
  cancelled: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function convertOpenAICoordinates(x: number, y: number): { x: number; y: number } {
  // Screenshots are now resized to logical screen resolution before sending to
  // the API, so the model returns coordinates in logical pixel space — which is
  // exactly what cliclick/macOS expects. Just clamp to screen bounds.
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.size;

  return {
    x: Math.max(0, Math.min(screenWidth - 1, Math.round(x))),
    y: Math.max(0, Math.min(screenHeight - 1, Math.round(y))),
  };
}

function pushUnique(items: string[], value: string): void {
  if (!items.includes(value)) {
    items.push(value);
  }
}

function toHistoryAction(action: ComputerAction): Record<string, unknown> {
  switch (action.type) {
    case 'click':
      if (action.button === 'right') {
        return { type: 'right_click', x: action.x, y: action.y };
      }
      return { type: 'click', x: action.x, y: action.y };
    case 'move':
      return { type: 'mouse_move', x: action.x, y: action.y };
    case 'keypress':
      return { type: 'key', key: (action.keys || []).join('+') };
    case 'drag': {
      const path = Array.isArray(action.path) ? action.path : [];
      const start = path[0];
      const end = path[path.length - 1];
      if (start && end) {
        return {
          type: 'drag',
          start_coordinate: [start.x, start.y],
          end_coordinate: [end.x, end.y],
        };
      }
      return {
        type: 'drag',
        start_x: action.startX ?? action.x,
        start_y: action.startY ?? action.y,
        end_x: action.endX,
        end_y: action.endY,
      };
    }
    default:
      return { ...action };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractOutputText(response: any): string {
  let text = '';

  for (const item of response.output || []) {
    if (item.type !== 'message' || !item.content) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const block of item.content as any[]) {
      if (block.type === 'output_text' && block.text) {
        text += block.text;
      }
    }
  }

  return text.trim();
}

function isEnterKeypress(action: ComputerAction): boolean {
  if (action.type !== 'keypress' || !Array.isArray(action.keys)) {
    return false;
  }

  return action.keys.some((key: string) => ['RETURN', 'ENTER'].includes(String(key).toUpperCase()));
}

async function waitAfterAction(current: ComputerAction, next: ComputerAction | null): Promise<void> {
  switch (current.type) {
    case 'type': {
      if (next?.type === 'keypress' && isEnterKeypress(next)) {
        await sleep(1500);
      } else {
        const textLen = current.text?.length || 0;
        await sleep(Math.max(50, Math.min(textLen * 5, 1000)));
      }
      return;
    }

    case 'keypress': {
      if (isEnterKeypress(current) && next?.type === 'type') {
        await sleep(2000);
      } else {
        await sleep(100);
      }
      return;
    }

    case 'click': {
      if (next && ['type', 'keypress'].includes(next.type)) {
        await sleep(1500);
      } else {
        await sleep(100);
      }
      return;
    }

    case 'double_click':
      await sleep(1500);
      return;

    case 'scroll':
    case 'move':
    case 'drag':
      await sleep(100);
      return;

    default:
      return;
  }
}

/**
 * Execute a single OpenAI computer use action.
 * Maps OpenAI's action format to our cliclick/applescript infrastructure.
 *
 * OpenAI action types: click, double_click, scroll, type, keypress, drag, move, wait, screenshot
 */
async function executeOpenAIAction(action: ComputerAction): Promise<string> {
  switch (action.type) {
    case 'click': {
      const button = action.button || 'left';
      const x = action.x;
      const y = action.y;
      if (x === undefined || y === undefined) throw new Error('click requires x, y');
      const point = convertOpenAICoordinates(x, y);
      if (button === 'right') {
        await cliclick.rightClick(point.x, point.y);
      } else {
        await cliclick.click(point.x, point.y);
      }
      return `Clicked (${point.x}, ${point.y})`;
    }

    case 'double_click': {
      const x = action.x;
      const y = action.y;
      if (x === undefined || y === undefined) throw new Error('double_click requires x, y');
      const point = convertOpenAICoordinates(x, y);
      await cliclick.doubleClick(point.x, point.y);
      return `Double-clicked (${point.x}, ${point.y})`;
    }

    case 'scroll': {
      const x = action.x;
      const y = action.y;
      const scrollX = action.scrollX || 0;
      const scrollY = action.scrollY || 0;

      // Move mouse to scroll position first
      if (x !== undefined && y !== undefined) {
        const point = convertOpenAICoordinates(x, y);
        await cliclick.moveMouse(point.x, point.y);
      }

      // Map scrollX/scrollY to cliclick scroll directions
      if (scrollY > 0) {
        await cliclick.scroll('down', Math.abs(Math.round(scrollY / 30)));
      } else if (scrollY < 0) {
        await cliclick.scroll('up', Math.abs(Math.round(scrollY / 30)));
      }
      if (scrollX > 0) {
        await cliclick.scroll('right', Math.abs(Math.round(scrollX / 30)));
      } else if (scrollX < 0) {
        await cliclick.scroll('left', Math.abs(Math.round(scrollX / 30)));
      }
      return `Scrolled (${scrollX}, ${scrollY})`;
    }

    case 'type': {
      const text = action.text;
      if (!text) throw new Error('type requires text');

      const CLIPBOARD_THRESHOLD = 100;
      if (text.length > CLIPBOARD_THRESHOLD) {
        const savedClipboard = clipboard.readText();
        clipboard.writeText(text);
        await sleep(50);
        await runAppleScript(`tell application "System Events" to keystroke "v" using command down`);
        await sleep(150);
        clipboard.writeText(savedClipboard);
      } else {
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.length > 0) {
            const CHUNK_SIZE = 20;
            for (let j = 0; j < line.length; j += CHUNK_SIZE) {
              const chunk = line.slice(j, j + CHUNK_SIZE);
              const escapedChunk = chunk.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              await runAppleScript(`tell application "System Events" to keystroke "${escapedChunk}"`);
              if (j + CHUNK_SIZE < line.length) await sleep(50);
            }
          }
          if (i < lines.length - 1) {
            await runAppleScript(`tell application "System Events" to key code 36`);
            await sleep(30);
          }
        }
      }
      return `Typed "${text.slice(0, 30)}${text.length > 30 ? '...' : ''}"`;
    }

    case 'keypress': {
      const keys: string[] = action.keys || [];
      // AppleScript key code map
      const keyCodeMap: Record<string, number> = {
        'RETURN': 36, 'ENTER': 36,
        'TAB': 48,
        'SPACE': 49,
        'DELETE': 51, 'BACKSPACE': 51,
        'ESCAPE': 53, 'ESC': 53,
        'UP': 126, 'DOWN': 125, 'LEFT': 123, 'RIGHT': 124,
        'HOME': 115, 'END': 119,
        'PAGEUP': 116, 'PAGEDOWN': 121,
      };

      const modifierMap: Record<string, string> = {
        'cmd': 'command down', 'command': 'command down', 'meta': 'command down',
        'ctrl': 'control down', 'control': 'control down',
        'alt': 'option down', 'option': 'option down',
        'shift': 'shift down',
      };

      const isModifier = (k: string): boolean => !!modifierMap[k.toLowerCase()];

      // OpenAI sends combos as separate array elements, e.g. ["CMD", "P"].
      // Collect modifier keys and execute them together with the final key.
      const collectedModifiers: string[] = [];
      const nonModifierKeys: string[] = [];

      for (const key of keys) {
        if (isModifier(key)) {
          const mod = modifierMap[key.toLowerCase()];
          if (!collectedModifiers.includes(mod)) collectedModifiers.push(mod);
        } else {
          nonModifierKeys.push(key);
        }
      }

      // Helper to execute a single key with accumulated modifiers
      const executeKey = async (key: string, modifiers: string[]): Promise<void> => {
        const modClause = modifiers.length > 0 ? ` using {${modifiers.join(', ')}}` : '';
        // Handle SPACE specially
        const normalizedKey = key === 'SPACE' ? ' ' : key;
        const keyCode = keyCodeMap[key.toUpperCase()];

        if (keyCode !== undefined) {
          await runAppleScript(`tell application "System Events" to key code ${keyCode}${modClause}`);
        } else if (normalizedKey.length === 1) {
          const escaped = normalizedKey.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          await runAppleScript(`tell application "System Events" to keystroke "${escaped}"${modClause}`);
        } else {
          // Try as "Meta+a" style combo within a single key string
          const parts = key.split('+');
          if (parts.length > 1) {
            const inlineModifiers = [...modifiers];
            const finalKey = parts[parts.length - 1];
            for (const part of parts.slice(0, -1)) {
              const mod = modifierMap[part.toLowerCase()];
              if (mod && !inlineModifiers.includes(mod)) inlineModifiers.push(mod);
            }
            const inlineModClause = inlineModifiers.length > 0 ? ` using {${inlineModifiers.join(', ')}}` : '';
            const fkc = keyCodeMap[finalKey.toUpperCase()];
            if (fkc !== undefined) {
              await runAppleScript(`tell application "System Events" to key code ${fkc}${inlineModClause}`);
            } else {
              await runAppleScript(`tell application "System Events" to keystroke "${finalKey}"${inlineModClause}`);
            }
          }
        }
      };

      if (nonModifierKeys.length > 0) {
        // Execute each non-modifier key with all collected modifiers
        for (const key of nonModifierKeys) {
          await executeKey(key, collectedModifiers);
        }
      } else if (collectedModifiers.length > 0) {
        // Only modifiers sent (rare) — just press them individually
        for (const key of keys) {
          await executeKey(key, []);
        }
      }

      return `Pressed keys: ${keys.join(', ')}`;
    }

    case 'drag': {
      const startPath = action.path?.[0];
      const endPath = action.path?.[action.path.length - 1];
      if (startPath && endPath) {
        const start = convertOpenAICoordinates(startPath.x, startPath.y);
        const end = convertOpenAICoordinates(endPath.x, endPath.y);
        await cliclick.drag(start.x, start.y, end.x, end.y);
        return `Dragged from (${start.x}, ${start.y}) to (${end.x}, ${end.y})`;
      }
      // Fallback: startX/startY/endX/endY
      const sx = action.startX ?? action.x;
      const sy = action.startY ?? action.y;
      const ex = action.endX;
      const ey = action.endY;
      if (sx !== undefined && sy !== undefined && ex !== undefined && ey !== undefined) {
        const start = convertOpenAICoordinates(sx, sy);
        const end = convertOpenAICoordinates(ex, ey);
        await cliclick.drag(start.x, start.y, end.x, end.y);
        return `Dragged from (${start.x}, ${start.y}) to (${end.x}, ${end.y})`;
      }
      throw new Error('drag requires path or start/end coordinates');
    }

    case 'move': {
      const x = action.x;
      const y = action.y;
      if (x === undefined || y === undefined) throw new Error('move requires x, y');
      const point = convertOpenAICoordinates(x, y);
      await cliclick.moveMouse(point.x, point.y);
      return `Moved mouse to (${point.x}, ${point.y})`;
    }

    case 'wait': {
      await sleep(2000);
      return 'Waited 2s';
    }

    case 'screenshot': {
      // Screenshot is handled separately in the loop — this is a no-op
      return 'Screenshot requested';
    }

    default:
      console.warn(`[OpenAI CUA] Unknown action type: ${action.type}`);
      return `Unknown action: ${action.type}`;
  }
}

/**
 * Capture a screenshot for OpenAI computer use.
 * OpenAI recommends 1440x900 or 1600x900 for best performance.
 * Uses `detail: "original"` to preserve full resolution.
 */
async function captureScreenshot(): Promise<string> {
  // OpenAI recommends sending the original screenshot at full fidelity for
  // better visual targeting, then remapping model coordinates back to logical
  // desktop points when executing OS-level input.
  const screenshot = await takeScreenshot({ provider: 'openai' });
  // Strip data URL prefix if present
  return screenshot.replace(/^data:image\/\w+;base64,/, '');
}

/**
 * Convert a LangChain DynamicStructuredTool to an OpenAI Responses API function tool definition.
 */
function toOpenAIFunctionTool(tool: DynamicStructuredTool): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(tool.schema, { target: 'openApi3' }) as Record<string, unknown>;
  // Remove $schema key which OpenAI doesn't accept
  delete jsonSchema['$schema'];
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: jsonSchema,
  };
}

/**
 * Run the OpenAI Responses API computer use loop.
 *
 * @param model - Model name
 * @param promptText - The user's task description
 * @param systemPrompt - System instructions for the model
 * @param callbacks - UI update callbacks
 * @param previousMessages - Prior conversation turns for context
 * @param tools - LangChain tools to expose as function calls (Composio, web_search, etc.)
 * @returns Final text response from the model
 */
export async function runOpenAIComputerUseLoop(
  model: string,
  promptText: string,
  systemPrompt: string,
  callbacks: OpenAICUACallbacks,
  previousMessages?: Array<{ role: 'user' | 'assistant'; content: string }>,
  tools: DynamicStructuredTool[] = []
): Promise<OpenAIComputerUseResult> {
  const toolsUsed: string[] = [];
  const actions: TraceAction[] = [];

  const recordThinking = (text: string): void => {
    if (!text.trim()) return;
    actions.push({ tool: '_thinking', input: { text: text.trim() }, timestamp: Date.now() });
  };

  const recordComputerActions = (computerActions: ComputerAction[]): void => {
    pushUnique(toolsUsed, 'computer_actions');
    actions.push({
      tool: 'computer_actions',
      input: { actions: computerActions.map(toHistoryAction) },
      timestamp: Date.now(),
    });
  };

  // Get API key / proxy config
  const config = await getOpenAIConfig();

  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.defaultHeaders ? { defaultHeaders: config.defaultHeaders } : {}),
  });

  // Build tool list: computer tool + any LangChain function tools
  const functionToolDefs = tools.map(toOpenAIFunctionTool);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allToolDefs: any[] = [{ type: 'computer' as const }, ...functionToolDefs];

  // First request: send task with computer tool enabled (no initial screenshot —
  // the model will request one via computer_call if it needs visual context).
  callbacks.sendStatus('Thinking...');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: any = await client.responses.create({
    model,
    instructions: systemPrompt,
    tools: allToolDefs,
    parallel_tool_calls: false,
    reasoning: { effort: 'low' as const },
    truncation: 'auto' as const,
    input: [
      ...(previousMessages || []).map(msg =>
        msg.role === 'assistant'
          ? { type: 'message' as const, id: `msg_prev_${Math.random().toString(36).slice(2, 14)}`, status: 'completed' as const, role: 'assistant' as const, content: [{ type: 'output_text' as const, text: msg.content, annotations: [] as never[] }] }
          : { role: 'user' as const, content: [{ type: 'input_text' as const, text: msg.content }] }
      ),
      {
        role: 'user' as const,
        content: [
          { type: 'input_text' as const, text: promptText },
        ],
      },
    ],
  });

  const MAX_TURNS = 30;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (callbacks.shouldCancel()) {
      return { response: '', toolsUsed, actions, cancelled: true };
    }

    const responseText = extractOutputText(response);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const computerCall = response.output?.find((item: any) => item.type === 'computer_call');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const functionCall = response.output?.find((item: any) => item.type === 'function_call');

    if (!computerCall && !functionCall) {
      // Final turn — no more tool calls
      if (responseText) {
        callbacks.sendChunkClear();
        callbacks.sendChunk(responseText);
      }
      return {
        response: responseText || 'Done.',
        toolsUsed,
        actions,
        cancelled: false,
      };
    }

    // Intermediate thinking text
    if (responseText) {
      recordThinking(responseText);
      callbacks.sendChunkClear();
      callbacks.sendChunk(responseText);
    }

    // ── Function call (Composio, web_search, etc.) ──────────────────────────
    if (functionCall) {
      const toolName: string = functionCall.name;
      const toolArgs: Record<string, unknown> = JSON.parse(functionCall.arguments || '{}');

      console.log(`[OpenAI CUA] Function call: ${toolName}`, JSON.stringify(toolArgs).slice(0, 300));
      pushUnique(toolsUsed, toolName);
      actions.push({ tool: toolName, input: toolArgs, timestamp: Date.now() });

      let toolResult: string;
      if (callbacks.executeFunction) {
        try {
          toolResult = await callbacks.executeFunction(toolName, toolArgs);
        } catch (err) {
          toolResult = `Error: ${err}`;
        }
      } else {
        toolResult = `Tool ${toolName} is not available in this mode.`;
      }

      if (callbacks.shouldCancel()) {
        return { response: '', toolsUsed, actions, cancelled: true };
      }

      callbacks.sendStatus('Thinking...');
      response = await client.responses.create({
        model,
        tools: allToolDefs,
        parallel_tool_calls: false,
        reasoning: { effort: 'low' as const },
        truncation: 'auto' as const,
        previous_response_id: response.id,
        input: [
          {
            type: 'function_call_output' as const,
            call_id: functionCall.call_id,
            output: toolResult,
          },
        ],
      });
      continue;
    }

    // ── Computer call ───────────────────────────────────────────────────────
    const computerActions: ComputerAction[] = computerCall.actions || [];
    recordComputerActions(computerActions);
    const actionSummary = computerActions.map((a: ComputerAction) => a.type).join(', ');
    callbacks.sendStatus(`Executing: ${actionSummary}...`);
    console.log(`[OpenAI CUA] Turn ${turn + 1}: ${computerActions.length} actions [${actionSummary}]`);

    const approval = await callbacks.requestApproval({
      actions: computerActions.map(toHistoryAction),
    });
    if (!approval.approved) {
      return {
        response: callbacks.shouldCancel() ? '' : (approval.reason || 'Action cancelled by user.'),
        toolsUsed,
        actions,
        cancelled: callbacks.shouldCancel(),
      };
    }

    for (let i = 0; i < computerActions.length; i++) {
      const action = computerActions[i];
      const nextAction = i < computerActions.length - 1 ? computerActions[i + 1] : null;

      if (callbacks.shouldCancel()) {
        return { response: '', toolsUsed, actions, cancelled: true };
      }

      try {
        const result = await executeOpenAIAction(action);
        console.log(`[OpenAI CUA] Action result: ${result}`);
      } catch (err) {
        console.error(`[OpenAI CUA] Action failed:`, err);
      }

      if (nextAction && !callbacks.shouldCancel()) {
        await waitAfterAction(action, nextAction);
      }
    }

    if (callbacks.shouldCancel()) {
      return { response: '', toolsUsed, actions, cancelled: true };
    }

    // Capture screenshot after computer actions
    callbacks.sendStatus('Taking screenshot...');
    await sleep(300); // Brief delay for UI to settle
    const screenshotBase64 = await captureScreenshot();
    if (callbacks.shouldCancel()) {
      return { response: '', toolsUsed, actions, cancelled: true };
    }

    callbacks.sendStatus('Thinking...');
    response = await client.responses.create({
      model,
      tools: allToolDefs,
      parallel_tool_calls: false,
      reasoning: { effort: 'low' as const },
      truncation: 'auto' as const,
      previous_response_id: response.id,
      input: [
        {
          type: 'computer_call_output' as const,
          call_id: computerCall.call_id,
          output: {
            type: 'computer_screenshot' as const,
            image_url: `data:image/png;base64,${screenshotBase64}`,
          },
        },
      ],
    });
  }

  return {
    response: callbacks.shouldCancel() ? '' : 'Stopped after reaching the computer-use turn limit.',
    toolsUsed,
    actions,
    cancelled: callbacks.shouldCancel(),
  };
}
