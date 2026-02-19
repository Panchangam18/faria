import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ToolResult, ToolContext } from './types';
import { runAppleScript, focusApp, escapeForAppleScript } from '../../services/applescript';
import { insertImageFromUrl } from '../../services/text-extraction';
import * as cliclick from '../../services/cliclick';
import { takeScreenshot, calculateResizeWidth } from '../../services/screenshot';
// NOTE: calculateResizeWidth must use the same constants as screenshot.ts to keep
// the coordinate conversion in sync with the actual screenshot dimensions.
import { screen, clipboard } from 'electron';
import type { ToolSettings } from '../../services/models';

// All possible action types
const ALL_ACTION_TYPES = [
  'activate',
  'applescript',
  'click',
  'right_click',
  'double_click',
  'type',
  'key',
  'mouse_move',
  'scroll',
  'drag',
  'wait',
  'screenshot',
  'insert_image',
] as const;

// Map tool settings to action types
const CLICKING_ACTIONS = new Set(['click', 'right_click', 'double_click', 'mouse_move']);
const SCROLLING_ACTIONS = new Set(['scroll', 'drag']);
const TYPING_ACTIONS = new Set(['type', 'key']);
const SCREENSHOT_ACTIONS = new Set(['screenshot']);
const INSERT_IMAGE_ACTIONS = new Set(['insert_image']);

// Helper to check if an action is disabled based on tool settings
function isActionDisabled(actionType: string, toolSettings: ToolSettings): boolean {
  if (CLICKING_ACTIONS.has(actionType) && toolSettings.clicking === 'disabled') return true;
  if (SCROLLING_ACTIONS.has(actionType) && toolSettings.scrolling === 'disabled') return true;
  if (TYPING_ACTIONS.has(actionType) && toolSettings.typing === 'disabled') return true;
  if (SCREENSHOT_ACTIONS.has(actionType) && toolSettings.screenshot === 'disabled') return true;
  if (INSERT_IMAGE_ACTIONS.has(actionType) && toolSettings.insertImage === 'disabled') return true;
  return false;
}

// Get list of enabled action types based on settings
function getEnabledActionTypes(toolSettings: ToolSettings): readonly string[] {
  return ALL_ACTION_TYPES.filter(action => !isActionDisabled(action, toolSettings));
}

// Zod schema for the tool (full version with all actions)
export const ChainActionsSchema = z.object({
  actions: z.array(
    z.object({
      type: z.enum(ALL_ACTION_TYPES),
      app: z.string().optional().describe('App name (for activate)'),
      script: z.string().optional().describe('AppleScript code (for applescript). CRITICAL: AppleScript uses DOUBLE QUOTES for all strings (e.g. tell application "Safari"). NEVER use single quotes — they are not valid AppleScript syntax and will cause a shell parsing error. Also avoid apostrophes in text literals; use curly quotes (\u2018\u2019) or rephrase instead.'),
      modifiers: z.array(z.string()).optional().describe('Modifier keys: cmd, ctrl, alt, shift (for key)'),
      key: z.string().optional().describe('Key to press, supports combos like "cmd+shift+f4" (for key)'),
      text: z.string().optional().describe('Text to type (for type)'),
      x: z.number().optional(),
      y: z.number().optional(),
      coordinate: z.array(z.number()).length(2).optional().describe('Click/move target [x, y]'),
      start_coordinate: z.array(z.number()).length(2).optional(),
      end_coordinate: z.array(z.number()).length(2).optional(),
      start_x: z.number().optional(),
      start_y: z.number().optional(),
      end_x: z.number().optional(),
      end_y: z.number().optional(),
      direction: z.enum(['up', 'down', 'left', 'right']).optional(),
      amount: z.number().optional(),
      scroll_direction: z.enum(['up', 'down', 'left', 'right']).optional(),
      scroll_amount: z.number().optional(),
      duration: z.number().optional(),
      query: z.string().optional().describe('Search query (for insert_image only)'),
    })
  ).describe('List of actions to execute in sequence. Types: activate, applescript, click, right_click, double_click, type, key, mouse_move, scroll, drag, wait, screenshot, insert_image. click/right_click/double_click REQUIRE coordinate or x+y (no text queries). key supports modifiers via "cmd+shift+k" syntax or separate modifiers array. Use app for activate, script for applescript.'),
});

/**
 * Convert model output coordinates to logical screen points for cliclick.
 *
 * Google Gemini: outputs 0-1000 normalized coordinates relative to the image.
 *   Formula: (coord / 1000) * logicalScreenSize
 *
 * Anthropic Claude: outputs pixel coordinates relative to the screenshot image.
 *   Screenshots are pre-resized to fit within Anthropic's vision constraints
 *   (1568px max edge, ~1.19MP total pixels) so the API won't further resize.
 *   We use the same calculateResizeWidth() to know the exact image dimensions
 *   Claude sees, then scale coordinates back to logical screen points.
 */
function convertCoordinates(x: number, y: number, provider: 'anthropic' | 'google' | null): { x: number; y: number } {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.size;
  const scaleFactor = primaryDisplay.scaleFactor || 1;

  if (provider === 'google') {
    // Gemini uses 0-1000 normalized coordinates (divide by 1000)
    // Coordinates above 1000 are treated as raw pixel values (fallthrough)
    if (x <= 1000 && y <= 1000) {
      const pixelX = Math.round((x / 1000) * screenWidth);
      const pixelY = Math.round((y / 1000) * screenHeight);
      console.log(`[Faria] Converting Google normalized (0-1000) coords (${x},${y}) -> logical (${pixelX},${pixelY}) for screen ${screenWidth}x${screenHeight}`);
      return { x: pixelX, y: pixelY };
    }
    return { x, y };
  }

  if (provider === 'anthropic') {
    // Screenshots are pre-resized using calculateResizeWidth() before sending to Claude.
    // This is the same function used by the screenshot service, so we know the exact
    // image dimensions Claude sees. Scale coordinates from image space to logical screen.
    const nativeWidth = screenWidth * scaleFactor;
    const nativeHeight = screenHeight * scaleFactor;
    const ssWidth = calculateResizeWidth(nativeWidth, nativeHeight);
    const ssHeight = Math.round(nativeHeight * (ssWidth / nativeWidth));

    const pixelX = Math.round((x / ssWidth) * screenWidth);
    const pixelY = Math.round((y / ssHeight) * screenHeight);
    console.log(`[Faria] Converting Anthropic coords (${x},${y}) from screenshot ${ssWidth}x${ssHeight} -> logical (${pixelX},${pixelY}) for screen ${screenWidth}x${screenHeight}`);
    return { x: pixelX, y: pixelY };
  }

  return { x, y };
}

// Timeout limits for waiting (ms)
const TIMEOUTS = {
  appActivate: 3000,      // Max time to wait for app to become frontmost
  windowAppear: 2000,     // Max time to wait for a new window/dialog
  uiSettle: 1500,         // Max time to wait for UI to settle after typing
  default: 1000,          // Default timeout
};

// Polling intervals (ms)
const POLL_INTERVAL = 50;

// Minimum delays for actions that don't have reliable completion signals
const MIN_DELAYS = {
  afterType: 50,          // Small delay after typing for UI to update
  afterKey: 100,          // After key press
  afterClick: 100,        // After click
  afterScroll: 100,       // After scroll
};

interface Action {
  type: 'activate' | 'applescript' | 'click' | 'right_click' | 'double_click' | 'type' | 'key' | 'mouse_move' | 'scroll' | 'drag' | 'wait' | 'screenshot' | 'insert_image';
  app?: string;           // For activate
  script?: string;        // For applescript
  modifiers?: string[];   // For hotkey (cmd, ctrl, alt, shift)
  key?: string;           // For hotkey, key
  text?: string;          // For type
  x?: number;             // For click
  y?: number;             // For click
  coordinate?: [number, number]; // For click/move (computer tool format)
  start_coordinate?: [number, number]; // For drag (computer tool format)
  end_coordinate?: [number, number];   // For drag (computer tool format)
  start_x?: number;       // For drag (Google format)
  start_y?: number;
  end_x?: number;
  end_y?: number;
  direction?: 'up' | 'down' | 'left' | 'right';  // For scroll
  amount?: number;        // For scroll, wait (ms)
  scroll_direction?: 'up' | 'down' | 'left' | 'right';
  scroll_amount?: number;
  duration?: number;      // For wait (ms)
  query?: string;         // For insert_image only (search query) — NOT for click
}

export interface ChainActionsParams {
  actions: Action[];
}

/**
 * Create a dynamic schema based on which actions are enabled
 */
function createDynamicSchema(toolSettings: ToolSettings) {
  const enabledActions = getEnabledActionTypes(toolSettings);

  // Need at least one action type for a valid enum
  if (enabledActions.length === 0) {
    // Return schema with only 'wait' which is always safe
    return z.object({
      actions: z.array(
        z.object({
          type: z.enum(['wait', 'activate', 'applescript', 'insert_image']),
          app: z.string().optional(),
          script: z.string().optional(),
          duration: z.number().optional(),
          query: z.string().optional(),
        })
      ).describe('List of actions to execute. Most actions are currently disabled in settings.'),
    });
  }

  return z.object({
    actions: z.array(
      z.object({
        type: z.enum(enabledActions as [string, ...string[]]),
        app: z.string().optional().describe('App name (for activate)'),
        script: z.string().optional().describe('AppleScript code (for applescript). CRITICAL: AppleScript uses DOUBLE QUOTES for all strings (e.g. tell application "Safari"). NEVER use single quotes — they are not valid AppleScript syntax and will cause a shell parsing error. Also avoid apostrophes in text literals; use curly quotes (\u2018\u2019) or rephrase instead.'),
        modifiers: z.array(z.string()).optional().describe('Modifier keys: cmd, ctrl, alt, shift (for key)'),
        key: z.string().optional().describe('Key to press, supports combos like "cmd+shift+f4" (for key)'),
        text: z.string().optional().describe('Text to type (for type)'),
        x: z.number().optional(),
        y: z.number().optional(),
        coordinate: z.array(z.number()).length(2).optional().describe('Click/move target [x, y]'),
        start_coordinate: z.array(z.number()).length(2).optional(),
        end_coordinate: z.array(z.number()).length(2).optional(),
        start_x: z.number().optional(),
        start_y: z.number().optional(),
        end_x: z.number().optional(),
        end_y: z.number().optional(),
        direction: z.enum(['up', 'down', 'left', 'right']).optional(),
        amount: z.number().optional(),
        scroll_direction: z.enum(['up', 'down', 'left', 'right']).optional(),
        scroll_amount: z.number().optional(),
        duration: z.number().optional(),
        query: z.string().optional().describe('Search query (for insert_image only)'),
      })
    ).describe(`List of actions to execute in sequence. Available actions: ${enabledActions.join(', ')}. click/right_click/double_click REQUIRE coordinate or x+y (no text queries). key supports modifiers via "cmd+shift+k" syntax or separate modifiers array.`),
  });
}

/**
 * Factory function that creates the chain actions tool with context injected
 * @param context - Tool context with state and app info
 * @param toolSettings - Configuration for which tools are enabled/disabled
 */
export function createChainActionsTool(context: ToolContext, toolSettings: ToolSettings): DynamicStructuredTool {
  const enabledActions = getEnabledActionTypes(toolSettings);
  const schema = createDynamicSchema(toolSettings);
  const description = `Execute a sequence of UI actions with automatic timing. Available actions: ${enabledActions.join(', ')}.`;

  return tool(
    async (input) => {
      const results: string[] = [];
      const images: string[] = [];

      try {
        for (let i = 0; i < input.actions.length; i++) {
          const action = input.actions[i];
          const nextAction = i < input.actions.length - 1 ? input.actions[i + 1] : null;

          // Check if action is disabled at runtime as well
          if (isActionDisabled(action.type, toolSettings)) {
            throw new Error(`Action "${action.type}" is not allowed. It is disabled in settings.`);
          }

          // Execute the action
          const result = await executeAction(action, context);
          if (result.image) {
            images.push(result.image);
          }
          if (result.message) {
            results.push(result.message);
          }

          // Wait for the appropriate condition before proceeding
          if (nextAction) {
            await waitForActionComplete(action, nextAction, context);
          }
        }

        const summary = `Completed ${input.actions.length} actions: ${results.join(' → ')}`;
        if (images.length > 0) {
          if (context.provider === 'google') {
            // Google doesn't accept image tool outputs; attach to next user message instead.
            context.addPendingImages(images);
            return summary;
          }

          const imageParts = images.map((data) => ({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data,
            },
          }));

          return [{ type: 'text', text: summary }, ...imageParts];
        }
        return summary;
      } catch (error) {
        throw new Error(`Failed at action ${results.length + 1}: ${error}`);
      }
    },
    {
      name: 'computer_actions',
      description,
      schema,
    }
  );
}

/**
 * Execute a chain of actions with dynamic waiting between them
 */
export async function chainActions(
  params: ChainActionsParams,
  context: ToolContext
): Promise<ToolResult> {
  const results: string[] = [];
  
  try {
    for (let i = 0; i < params.actions.length; i++) {
      const action = params.actions[i];
      const nextAction = i < params.actions.length - 1 ? params.actions[i + 1] : null;
      
      // Execute the action
      const result = await executeAction(action, context);
      if (result.message) {
        results.push(result.message);
      }
      
      // Wait for the appropriate condition before proceeding
      if (nextAction) {
        await waitForActionComplete(action, nextAction, context);
      }
    }
    
    return { 
      success: true, 
      result: `Completed ${params.actions.length} actions: ${results.join(' → ')}` 
    };
  } catch (error) {
    return { 
      success: false, 
      error: `Failed at action ${results.length + 1}: ${error}` 
    };
  }
}

async function executeAction(
  action: Action,
  context: ToolContext
): Promise<{ message?: string; image?: string }> {
  switch (action.type) {
    case 'activate': {
      if (!action.app) throw new Error('App name required for activate');
      console.log(`[Faria] Activating app: ${action.app}`);
      await focusApp(action.app);
      context.setTargetApp(action.app);
      return { message: `Activated ${action.app}` };
    }

    case 'applescript': {
      if (!action.script) throw new Error('Script required for applescript');
      await runAppleScript(action.script);
      return { message: 'Ran AppleScript' };
    }
    
    case 'type': {
      if (!action.text) throw new Error('Text required for type');

      const CLIPBOARD_THRESHOLD = 100;

      if (action.text.length > CLIPBOARD_THRESHOLD) {
        // For long text, use clipboard paste — keystroke is slow and lossy
        // for anything beyond a short string.
        const savedClipboard = clipboard.readText();
        clipboard.writeText(action.text);
        await sleep(50);

        const targetApp = context.targetApp;
        if (targetApp) {
          // Paste via Edit menu (more reliable than Cmd+V)
          const script = `
            tell application "System Events"
              tell process "${escapeForAppleScript(targetApp)}"
                click menu item "Paste" of menu "Edit" of menu bar 1
              end tell
            end tell
          `;
          console.log(`[Faria] Pasting ${action.text.length} chars via clipboard into ${targetApp}`);
          await runAppleScript(script);
        } else {
          // Fallback: Cmd+V if we don't know the target app
          console.log(`[Faria] Pasting ${action.text.length} chars via Cmd+V (no target app)`);
          await runAppleScript(`tell application "System Events" to keystroke "v" using command down`);
        }

        await sleep(150);
        clipboard.writeText(savedClipboard);
      } else {
        // For short text, use keystroke (better for search bars, form fields, etc.)
        const lines = action.text.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.length > 0) {
            const CHUNK_SIZE = 20;
            for (let j = 0; j < line.length; j += CHUNK_SIZE) {
              const chunk = line.slice(j, j + CHUNK_SIZE);
              const escapedChunk = chunk.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              const script = `tell application "System Events" to keystroke "${escapedChunk}"`;
              if (j === 0) {
                console.log(`[Faria] Executing type script: ${script.slice(0, 100)}...`);
              }
              await runAppleScript(script);
              if (j + CHUNK_SIZE < line.length) {
                await sleep(50);
              }
            }
          }

          // Press Return for newlines (except after the last line)
          if (i < lines.length - 1) {
            await runAppleScript(`tell application "System Events" to key code 36`);
            await sleep(MIN_DELAYS.afterKey);
          }
        }

        const totalLen = action.text.length;
        if (totalLen > 10) {
          await sleep(Math.min(totalLen * 5, 1000));
        }
      }

      return { message: `Typed "${action.text.slice(0, 30)}${action.text.length > 30 ? '...' : ''}"` };
    }
    
    case 'key': {
      if (!action.key) throw new Error('Key required');

      // Parse combo keys like "cmd+shift+f4" into modifiers + key
      const parts = action.key.split('+').map(part => part.trim()).filter(Boolean);
      const comboKey = parts.length > 1 ? parts.pop()! : null;
      const comboModifiers = parts.length > 0 ? parts : [];
      const extraModifiers = action.modifiers || [];
      const allModifiers = comboKey
        ? comboModifiers.concat(extraModifiers)
        : extraModifiers;
      const finalKey = comboKey || action.key;

      // macOS key code map for special keys
      const keyCodeMap: Record<string, number> = {
        'return': 36, 'enter': 36,
        'tab': 48,
        'space': 49,
        'delete': 51, 'backspace': 51,
        'escape': 53, 'esc': 53,
        'up': 126, 'down': 125, 'left': 123, 'right': 124,
        'home': 115, 'end': 119,
        'pageup': 116, 'pagedown': 121,
        'f1': 122, 'f2': 120, 'f3': 99, 'f4': 118,
        'f5': 96, 'f6': 97, 'f7': 98, 'f8': 100,
        'f9': 101, 'f10': 109, 'f11': 103, 'f12': 111,
        'f13': 105, 'f14': 107, 'f15': 113, 'f16': 106,
      };

      // AppleScript modifier name map
      const asModMap: Record<string, string> = {
        cmd: 'command down', command: 'command down',
        ctrl: 'control down', control: 'control down',
        alt: 'option down', option: 'option down',
        shift: 'shift down',
      };

      const keyCode = keyCodeMap[finalKey.toLowerCase()];
      const modClause = allModifiers.length > 0
        ? ` using {${allModifiers.map(m => asModMap[m.toLowerCase()] || `${m} down`).join(', ')}}`
        : '';

      let script: string;
      if (keyCode !== undefined) {
        script = `tell application "System Events" to key code ${keyCode}${modClause}`;
      } else {
        script = `tell application "System Events" to keystroke "${finalKey}"${modClause}`;
      }

      const label = allModifiers.length > 0
        ? `${allModifiers.join('+')}+${finalKey}`
        : finalKey;
      console.log(`[Faria] Executing key script: ${script}`);
      await runAppleScript(script);
      return { message: `Pressed ${label}` };
    }
    
    case 'click': {
      const point = resolvePoint(action, context);
      if (!point) throw new Error('Coordinates required for click');
      const { x, y } = point;
      await cliclick.click(x, y);
      return { message: `Clicked (${x}, ${y})` };
    }

    case 'right_click': {
      const point = resolvePoint(action, context);
      if (!point) throw new Error('Coordinates required for right_click');
      const { x, y } = point;
      await cliclick.rightClick(x, y);
      return { message: `Right-clicked (${x}, ${y})` };
    }

    case 'double_click': {
      const point = resolvePoint(action, context);
      if (!point) throw new Error('Coordinates required for double_click');
      const { x, y } = point;
      await cliclick.doubleClick(x, y);
      return { message: `Double-clicked (${x}, ${y})` };
    }

    case 'mouse_move': {
      const point = resolvePoint(action, context);
      if (!point) throw new Error('Coordinates required for mouse_move');
      const { x, y } = point;
      await cliclick.moveMouse(x, y);
      return { message: `Moved mouse to (${x}, ${y})` };
    }
    
    case 'scroll': {
      const direction = action.direction || action.scroll_direction || 'down';
      const amount = action.amount || action.scroll_amount || 3;
      await cliclick.scroll(direction, amount);
      return { message: `Scrolled ${direction}` };
    }
    
    case 'wait': {
      const ms = action.amount || action.duration || 500;
      await sleep(ms);
      return { message: `Waited ${ms}ms` };
    }

    case 'insert_image': {
      if (!action.query) throw new Error('Query required for insert_image');

      const serperKey = process.env.SERPER_API_KEY;
      if (!serperKey) {
        throw new Error('Serper API key not configured in .env (SERPER_API_KEY)');
      }

      // Search for image using Serper API
      const response = await fetch('https://google.serper.dev/images', {
        method: 'POST',
        headers: {
          'X-API-KEY': serperKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ q: action.query, num: 5 })
      });

      if (!response.ok) {
        throw new Error(`Serper API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.images || data.images.length === 0) {
        throw new Error(`No images found for "${action.query}"`);
      }

      const imageUrl = data.images[0].imageUrl;

      // Insert the image at cursor position
      const result = await insertImageFromUrl(context.targetApp, imageUrl);

      if (!result.success) {
        throw new Error(result.error || 'Failed to insert image');
      }

      return { message: `Inserted image for "${action.query}"` };
    }

    case 'screenshot': {
      const screenshot = await takeScreenshot({ provider: context.provider });
      const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
      return { message: 'Screenshot captured', image: base64Data };
    }

    case 'drag': {
      const drag = resolveDrag(action, context);
      if (!drag) throw new Error('Start and end coordinates required for drag');
      await cliclick.drag(drag.start.x, drag.start.y, drag.end.x, drag.end.y);
      return { message: `Dragged from (${drag.start.x}, ${drag.start.y}) to (${drag.end.x}, ${drag.end.y})` };
    }

    default:
      throw new Error(`Unknown action type: ${(action as Action).type}`);
  }
}

function resolvePoint(action: Action, context: ToolContext): { x: number; y: number } | null {
  if (action.coordinate) {
    const [x, y] = action.coordinate;
    return convertCoordinates(x, y, context.provider);
  }
  if (action.x !== undefined && action.y !== undefined) {
    return convertCoordinates(action.x, action.y, context.provider);
  }
  return null;
}

function resolveDrag(
  action: Action,
  context: ToolContext
): { start: { x: number; y: number }; end: { x: number; y: number } } | null {
  if (action.start_coordinate && action.end_coordinate) {
    const [startX, startY] = action.start_coordinate;
    const [endX, endY] = action.end_coordinate;
    return {
      start: convertCoordinates(startX, startY, context.provider),
      end: convertCoordinates(endX, endY, context.provider),
    };
  }
  if (
    action.start_x !== undefined &&
    action.start_y !== undefined &&
    action.end_x !== undefined &&
    action.end_y !== undefined
  ) {
    return {
      start: convertCoordinates(action.start_x, action.start_y, context.provider),
      end: convertCoordinates(action.end_x, action.end_y, context.provider),
    };
  }
  return null;
}

/**
 * Wait for an action to complete before proceeding to the next action
 * Uses dynamic waiting based on actual conditions rather than static delays
 */
async function waitForActionComplete(
  current: Action, 
  next: Action,
  context: ToolContext
): Promise<void> {
  switch (current.type) {
    case 'activate': {
      // Wait for app to become frontmost
      if (current.app) {
        await waitForCondition(
          () => isAppFrontmost(current.app!),
          TIMEOUTS.appActivate,
          `App ${current.app} to become frontmost`
        );
      }
      break;
    }

    case 'applescript': {
      await sleep(MIN_DELAYS.afterKey);
      break;
    }
    
    case 'type': {
      // If next action is Enter/Return, wait longer for search results to populate
      if (next.type === 'key' && ['return', 'enter'].includes(next.key?.toLowerCase() || '')) {
        await waitForUISettle(TIMEOUTS.uiSettle);
      } else {
        // Wait proportionally to text length — keystroke events queue up and the
        // target app may still be processing them when osascript returns.
        const textLen = current.text?.length || 0;
        const delay = Math.max(MIN_DELAYS.afterType, Math.min(textLen * 5, 1000));
        await sleep(delay);
      }
      break;
    }
    
    case 'key': {
      // If we pressed Enter and next is type, we likely navigated somewhere - wait for UI
      if (['return', 'enter'].includes(current.key?.toLowerCase() || '') && next.type === 'type') {
        await waitForUISettle(TIMEOUTS.windowAppear);
      } else {
        await sleep(MIN_DELAYS.afterKey);
      }
      break;
    }
    
    case 'click': {
      // If next action is type or key, we likely clicked into a field/console — wait for focus
      if (next.type === 'type' || next.type === 'key') {
        await waitForUISettle(TIMEOUTS.uiSettle);
      } else {
        await sleep(MIN_DELAYS.afterClick);
      }
      break;
    }

    case 'right_click':
    case 'double_click': {
      // Context menus / double-click selections need time to appear
      await waitForUISettle(TIMEOUTS.uiSettle);
      break;
    }
    
    case 'scroll': {
      await sleep(MIN_DELAYS.afterScroll);
      break;
    }

    case 'mouse_move':
    case 'drag': {
      await sleep(MIN_DELAYS.afterClick);
      break;
    }

    case 'insert_image': {
      // Image insertion involves clipboard and paste - wait for UI to settle
      await waitForUISettle(TIMEOUTS.uiSettle);
      break;
    }

    case 'screenshot': {
      // No UI wait needed for screenshot
      break;
    }
  }
}

/**
 * Check if an app is the frontmost application
 */
async function isAppFrontmost(appName: string): Promise<boolean> {
  try {
    const script = `tell application "System Events" to return name of first application process whose frontmost is true`;
    const result = await runAppleScript(script);
    // Normalize names for comparison (e.g., "Google Chrome" vs "Chrome")
    const normalizedResult = result?.toLowerCase().trim() || '';
    const normalizedApp = appName.toLowerCase().trim();
    return normalizedResult.includes(normalizedApp) || normalizedApp.includes(normalizedResult);
  } catch {
    return false;
  }
}

/**
 * Wait for UI to settle by checking if window count has stabilized
 * Uses a simple heuristic: wait until no new windows appear for a short period
 */
async function waitForUISettle(timeout: number): Promise<void> {
  const startTime = Date.now();
  let lastWindowCount = await getWindowCount();
  let stableCount = 0;
  const requiredStableChecks = 3; // Must be stable for 3 checks
  
  while (Date.now() - startTime < timeout) {
    await sleep(POLL_INTERVAL);
    
    const currentCount = await getWindowCount();
    
    if (currentCount === lastWindowCount) {
      stableCount++;
      if (stableCount >= requiredStableChecks) {
        // UI has stabilized
        return;
      }
    } else {
      // Window count changed, reset stability counter
      stableCount = 0;
      lastWindowCount = currentCount;
    }
  }
  
  // Timeout reached, proceed anyway
}

/**
 * Get the total window count across all apps (rough heuristic for UI changes)
 */
async function getWindowCount(): Promise<number> {
  try {
    // Simpler approach - just count windows of the frontmost app
    const script = `tell application "System Events" to return count of windows of first application process whose frontmost is true`;
    const result = await runAppleScript(script);
    return parseInt(result || '0', 10);
  } catch {
    return 0;
  }
}

/**
 * Wait for a condition to become true with timeout
 */
async function waitForCondition(
  condition: () => Promise<boolean>,
  timeout: number,
  description: string
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await sleep(POLL_INTERVAL);
  }
  
  // Log timeout but don't fail - proceed anyway
  console.log(`[Faria] Timeout waiting for: ${description}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
