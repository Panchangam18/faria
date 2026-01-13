import { ToolDefinition } from './types';

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'execute_script',
    description: 'Execute native code in an application\'s scripting runtime (Python for Blender, JavaScript for Photoshop, AppleScript for Office apps)',
    parameters: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'Name of the application to execute code in' },
        code: { type: 'string', description: 'The code to execute' },
        language: { 
          type: 'string', 
          description: 'Override language (optional)',
          enum: ['python', 'javascript', 'applescript']
        },
      },
      required: ['app', 'code'],
    },
  },
  {
    name: 'send_keystrokes',
    description: 'Type text using keyboard simulation',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The text to type' },
      },
      required: ['text'],
    },
  },
  {
    name: 'send_hotkey',
    description: 'Send a keyboard shortcut (e.g., Cmd+C, Ctrl+Shift+P)',
    parameters: {
      type: 'object',
      properties: {
        modifiers: { 
          type: 'array',
          items: { type: 'string' },
          description: 'Modifier keys: cmd, ctrl, alt, shift'
        },
        key: { type: 'string', description: 'The key to press (e.g., c, v, enter, tab, escape)' },
      },
      required: ['key'],
    },
  },
  {
    name: 'click',
    description: 'Click at screen coordinates. Use the coordinates shown in the state (e.g., @(553,132) means x=553, y=132)',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate on screen' },
        y: { type: 'number', description: 'Y coordinate on screen' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the current view',
    parameters: {
      type: 'object',
      properties: {
        direction: { 
          type: 'string',
          enum: ['up', 'down', 'left', 'right'],
          description: 'Direction to scroll'
        },
        amount: { type: 'number', description: 'Number of pages to scroll (default: 1)' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'focus_app',
    description: 'Bring an application to the foreground',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the application to focus' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_state',
    description: 'Re-extract the current application state',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'find_replace',
    description: 'Find and replace text using keyboard shortcuts (Cmd+H)',
    parameters: {
      type: 'object',
      properties: {
        find: { type: 'string', description: 'Text to find' },
        replace: { type: 'string', description: 'Text to replace with' },
      },
      required: ['find', 'replace'],
    },
  },
  {
    name: 'run_applescript',
    description: 'Execute raw AppleScript code',
    parameters: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'The AppleScript code to execute' },
      },
      required: ['script'],
    },
  },
  {
    name: 'run_shell',
    description: 'Execute a shell command',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
      },
      required: ['command'],
    },
  },
  {
    name: 'search_tools',
    description: 'Search for custom tools by query',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        type: { 
          type: 'string',
          enum: ['bm25', 'grep'],
          description: 'Search type (default: bm25)'
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_tool',
    description: 'Create a new custom tool for future use',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Tool name (snake_case)' },
        description: { type: 'string', description: 'What the tool does' },
        parameters: { type: 'string', description: 'JSON schema for parameters' },
        code: { type: 'string', description: 'JavaScript code implementing the tool' },
      },
      required: ['name', 'description', 'parameters', 'code'],
    },
  },
  {
    name: 'chain_actions',
    description: 'Execute a sequence of actions with automatic timing. PREFERRED for multi-step UI tasks. Actions: activate (switch app), hotkey (keyboard shortcut), type (text), key (single key like return/tab), click, scroll, wait.',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'List of actions to execute in sequence. Each action has: type (activate/hotkey/type/key/click/scroll/wait), app (for activate), modifiers+key (for hotkey), text (for type), key (for key), x+y (for click), direction (for scroll), amount (for wait ms)',
          items: { type: 'object' },
        },
      },
      required: ['actions'],
    },
  },
];

