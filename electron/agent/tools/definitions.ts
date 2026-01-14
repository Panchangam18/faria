import { ToolDefinition } from './types';

export const toolDefinitions: ToolDefinition[] = [
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

