import Anthropic from '@anthropic-ai/sdk';
import { SchemaType, FunctionDeclaration } from '@google/generative-ai';

/**
 * Generic tool definition that works across providers
 */
export interface GenericTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Generic tool definitions (provider-agnostic)
 */
export const INLINE_TOOLS_GENERIC: GenericTool[] = [
  {
    name: 'web_search',
    description: 'Search the web for information and facts. NOT for images - use search_image for images.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'make_edit',
    description: 'Make text replacements. Each edit specifies exact text to find and what to replace it with. The oldText MUST match exactly what appears in the context.',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldText: {
                type: 'string',
                description: 'The exact text to find and replace (must match context exactly)'
              },
              newText: {
                type: 'string', 
                description: 'The replacement text'
              }
            },
            required: ['oldText', 'newText']
          },
          description: 'Array of text replacements to make'
        }
      },
      required: ['edits']
    }
  },
  {
    name: 'insert_image',
    description: 'Search Google Images and insert the best result at cursor position.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Google image search query (e.g. "golden retriever puppy", "sunset over ocean", "modern office workspace")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'answer',
    description: 'Respond with a text answer. Use this when no action is needed, just information.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The response text'
        }
      },
      required: ['text']
    }
  }
];

/**
 * Tool definitions for Anthropic API format
 */
export const INLINE_TOOLS: Anthropic.Tool[] = INLINE_TOOLS_GENERIC.map(tool => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.parameters
}));

/**
 * Tool definitions for Google Gemini format
 * Google requires SchemaType enum values instead of string literals
 */
export const INLINE_TOOLS_GOOGLE: FunctionDeclaration[] = [
  {
    name: 'web_search',
    description: 'Search the web for information and facts. NOT for images - use search_image for images.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: 'The search query'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'make_edit',
    description: 'Make text replacements. Each edit specifies exact text to find and what to replace it with. The oldText MUST match exactly what appears in the context.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        edits: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              oldText: {
                type: SchemaType.STRING,
                description: 'The exact text to find and replace (must match context exactly)'
              },
              newText: {
                type: SchemaType.STRING, 
                description: 'The replacement text'
              }
            },
            required: ['oldText', 'newText']
          },
          description: 'Array of text replacements to make'
        }
      },
      required: ['edits']
    }
  },
  {
    name: 'insert_image',
    description: 'Search Google Images and insert the best result at cursor position.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: 'Google image search query (e.g. "golden retriever puppy", "sunset over ocean", "modern office workspace")'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'answer',
    description: 'Respond with a text answer. Use this when no action is needed, just information.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        text: {
          type: SchemaType.STRING,
          description: 'The response text'
        }
      },
      required: ['text']
    }
  }
];
