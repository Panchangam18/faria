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
    description: 'Execute a sequence of actions with automatic timing. PREFERRED for multi-step UI tasks. Actions: activate (switch app), hotkey (keyboard shortcut), type (text), key (single key like return/tab), click, scroll, wait, insert_image (search and insert image at cursor).',
    parameters: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          description: 'List of actions to execute in sequence. Each action has: type (activate/hotkey/type/key/click/scroll/wait/insert_image), app (for activate), modifiers+key (for hotkey), text (for type), key (for key), x+y (for click), direction (for scroll), amount (for wait ms), query (for insert_image)',
          items: { type: 'object' },
        },
      },
      required: ['actions'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for information using DuckDuckGo. Returns facts and information.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'insert_image',
    description: 'Search Google Images and insert the best result at cursor position.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Image search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'replace_selected_text',
    description: 'Replace the currently selected text in the target app with new text. Use this when the user has text selected (shown as USER SELECTED TEXT in state) and wants to modify/replace/expand it. The selected text will be replaced with your new text.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The replacement text that will replace the current selection' },
      },
      required: ['text'],
    },
  },
];

