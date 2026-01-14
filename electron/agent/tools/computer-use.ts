import { takeScreenshot } from '../../services/screenshot';
import * as cliclick from '../../services/cliclick';

// Computer use action type
export interface ComputerAction {
  action: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  end_coordinate?: [number, number];
  text?: string;
  key?: string;
  scroll_direction?: 'up' | 'down' | 'left' | 'right';
  scroll_amount?: number;
  duration?: number;
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
 * Execute a computer use tool action
 * Returns content for ToolMessage (string or image array)
 */
export async function executeComputerAction(action: ComputerAction): Promise<ComputerActionResult> {
  console.log(`[Faria] Computer action: ${action.action}`, JSON.stringify(action).slice(0, 200));
  
  switch (action.action) {
    case 'screenshot': {
      const screenshot = await takeScreenshot();
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
      if (action.coordinate) {
        await cliclick.click(action.coordinate[0], action.coordinate[1]);
        return `Clicked at (${action.coordinate[0]}, ${action.coordinate[1]})`;
      }
      throw new Error('Coordinate required for left_click');
    }
    
    case 'right_click': {
      if (action.coordinate) {
        await cliclick.rightClick(action.coordinate[0], action.coordinate[1]);
        return `Right-clicked at (${action.coordinate[0]}, ${action.coordinate[1]})`;
      }
      throw new Error('Coordinate required for right_click');
    }
    
    case 'middle_click': {
      if (action.coordinate) {
        // Middle click - use cliclick with middle button
        await cliclick.click(action.coordinate[0], action.coordinate[1]);
        return `Middle-clicked at (${action.coordinate[0]}, ${action.coordinate[1]})`;
      }
      throw new Error('Coordinate required for middle_click');
    }
    
    case 'double_click': {
      if (action.coordinate) {
        await cliclick.doubleClick(action.coordinate[0], action.coordinate[1]);
        return `Double-clicked at (${action.coordinate[0]}, ${action.coordinate[1]})`;
      }
      throw new Error('Coordinate required for double_click');
    }
    
    case 'triple_click': {
      if (action.coordinate) {
        // Triple click - three rapid clicks
        await cliclick.click(action.coordinate[0], action.coordinate[1]);
        await cliclick.click(action.coordinate[0], action.coordinate[1]);
        await cliclick.click(action.coordinate[0], action.coordinate[1]);
        return `Triple-clicked at (${action.coordinate[0]}, ${action.coordinate[1]})`;
      }
      throw new Error('Coordinate required for triple_click');
    }
    
    case 'mouse_move': {
      if (action.coordinate) {
        await cliclick.moveMouse(action.coordinate[0], action.coordinate[1]);
        return `Moved mouse to (${action.coordinate[0]}, ${action.coordinate[1]})`;
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
      if (action.start_coordinate && action.end_coordinate) {
        const [startX, startY] = action.start_coordinate;
        const [endX, endY] = action.end_coordinate;
        await cliclick.drag(startX, startY, endX, endY);
        return `Dragged from (${startX}, ${startY}) to (${endX}, ${endY})`;
      }
      throw new Error('Start and end coordinates required for drag');
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

