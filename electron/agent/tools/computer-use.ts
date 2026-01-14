import { takeScreenshot } from '../../services/screenshot';
import * as cliclick from '../../services/cliclick';

// Computer use action type - supports both Anthropic and Google formats
export interface ComputerAction {
  action: string;
  // Anthropic format
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  end_coordinate?: [number, number];
  text?: string;
  key?: string;
  scroll_direction?: 'up' | 'down' | 'left' | 'right';
  scroll_amount?: number;
  duration?: number;
  // Google format (normalized 0-1 coordinates)
  x?: number;
  y?: number;
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
}

// Return type for computer actions
export type ComputerActionResult = string | Array<{
  type: string;
  source?: {
    type: string;
    media_type: string;
    data: string;
  };
}>;

/**
 * Normalize action name to handle both Anthropic and Google formats
 */
function normalizeAction(action: string): string {
  const aliases: Record<string, string> = {
    // Google -> Anthropic mappings
    'click': 'left_click',
    'click_at': 'left_click',
    'left_click_at': 'left_click',
    'right_click_at': 'right_click',
    'double_click_at': 'double_click',
    'type_text': 'type',
    'type_text_at': 'type',
    'press_key': 'key',
    'key_press': 'key',
    'take_screenshot': 'screenshot',
    'move_mouse': 'mouse_move',
    'drag': 'left_click_drag',
    'drag_and_drop': 'left_click_drag',
  };
  return aliases[action] || action;
}

/**
 * Get coordinates from action, handling both formats
 * Anthropic uses coordinate: [x, y]
 * Google might use x, y as separate normalized (0-1) values
 */
function getCoordinate(action: ComputerAction, screenWidth = 1920, screenHeight = 1080): [number, number] | undefined {
  if (action.coordinate) {
    return action.coordinate;
  }
  // Google uses normalized coordinates (0-1), convert to pixels
  if (action.x !== undefined && action.y !== undefined) {
    const x = action.x <= 1 ? Math.round(action.x * screenWidth) : action.x;
    const y = action.y <= 1 ? Math.round(action.y * screenHeight) : action.y;
    return [x, y];
  }
  return undefined;
}

/**
 * Execute a computer use tool action
 * Returns content for ToolMessage (string or image array)
 * Handles both Anthropic and Google action formats
 */
export async function executeComputerAction(action: ComputerAction): Promise<ComputerActionResult> {
  const normalizedAction = normalizeAction(action.action);
  console.log(`[Faria] Computer action: ${action.action} -> ${normalizedAction}`, JSON.stringify(action).slice(0, 200));
  
  switch (normalizedAction) {
    case 'screenshot': {
      // Use preserveSize to ensure coordinates match the screen dimensions we told Claude
      const screenshot = await takeScreenshot({ preserveSize: true });
      // Return base64 data without the data:image/png;base64, prefix
      const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
      return [{
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: base64Data,
        },
      }];
    }
    
    case 'left_click': {
      const coord = getCoordinate(action);
      if (coord) {
        await cliclick.click(coord[0], coord[1]);
        return `Clicked at (${coord[0]}, ${coord[1]})`;
      }
      throw new Error('Coordinate required for left_click');
    }
    
    case 'right_click': {
      const coord = getCoordinate(action);
      if (coord) {
        await cliclick.rightClick(coord[0], coord[1]);
        return `Right-clicked at (${coord[0]}, ${coord[1]})`;
      }
      throw new Error('Coordinate required for right_click');
    }
    
    case 'middle_click': {
      const coord = getCoordinate(action);
      if (coord) {
        // Middle click - use cliclick with middle button
        await cliclick.click(coord[0], coord[1]);
        return `Middle-clicked at (${coord[0]}, ${coord[1]})`;
      }
      throw new Error('Coordinate required for middle_click');
    }
    
    case 'double_click': {
      const coord = getCoordinate(action);
      if (coord) {
        await cliclick.doubleClick(coord[0], coord[1]);
        return `Double-clicked at (${coord[0]}, ${coord[1]})`;
      }
      throw new Error('Coordinate required for double_click');
    }
    
    case 'triple_click': {
      const coord = getCoordinate(action);
      if (coord) {
        // Triple click - three rapid clicks
        await cliclick.click(coord[0], coord[1]);
        await cliclick.click(coord[0], coord[1]);
        await cliclick.click(coord[0], coord[1]);
        return `Triple-clicked at (${coord[0]}, ${coord[1]})`;
      }
      throw new Error('Coordinate required for triple_click');
    }
    
    case 'mouse_move': {
      const coord = getCoordinate(action);
      if (coord) {
        await cliclick.moveMouse(coord[0], coord[1]);
        return `Moved mouse to (${coord[0]}, ${coord[1]})`;
      }
      throw new Error('Coordinate required for mouse_move');
    }
    
    case 'type': {
      if (action.text) {
        await cliclick.sendKeystrokes(action.text);
        return `Typed: "${action.text}"`;
      }
      throw new Error('Text required for type action');
    }
    
    case 'key': {
      if (action.key) {
        // Parse key combination like "cmd+t" or "Return"
        const parts = action.key.toLowerCase().split('+');
        const key = parts.pop() || '';
        const modifiers = parts;
        await cliclick.sendHotkey(modifiers, key);
        return `Pressed key: ${action.key}`;
      }
      throw new Error('Key required for key action');
    }
    
    case 'scroll': {
      const direction = action.scroll_direction || 'down';
      const amount = action.scroll_amount || 3;
      await cliclick.scroll(direction, amount);
      return `Scrolled ${direction} by ${amount}`;
    }
    
    case 'left_click_drag': {
      // Handle both formats
      let startX: number, startY: number, endX: number, endY: number;
      
      if (action.start_coordinate && action.end_coordinate) {
        [startX, startY] = action.start_coordinate;
        [endX, endY] = action.end_coordinate;
      } else if (action.start_x !== undefined && action.start_y !== undefined && 
                 action.end_x !== undefined && action.end_y !== undefined) {
        // Google normalized format
        startX = action.start_x <= 1 ? Math.round(action.start_x * 1920) : action.start_x;
        startY = action.start_y <= 1 ? Math.round(action.start_y * 1080) : action.start_y;
        endX = action.end_x <= 1 ? Math.round(action.end_x * 1920) : action.end_x;
        endY = action.end_y <= 1 ? Math.round(action.end_y * 1080) : action.end_y;
      } else {
        throw new Error('Start and end coordinates required for drag');
      }
      
      await cliclick.drag(startX, startY, endX, endY);
      return `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})`;
    }
    
    case 'wait': {
      const duration = action.duration || 1000;
      await cliclick.sleep(duration);
      return `Waited ${duration}ms`;
    }
    
    default:
      return `Unknown action: ${action.action}`;
  }
}
