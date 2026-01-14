import Anthropic from '@anthropic-ai/sdk';

/**
 * Tool definitions for Anthropic API
 */
export const INLINE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description: 'Search the web for information and facts. NOT for images - use search_image for images.',
    input_schema: {
      type: 'object' as const,
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
    name: 'suggest_edits',
    description: 'Suggest text replacements. Each edit specifies exact text to find and what to replace it with. The oldText MUST match exactly what appears in the context.',
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
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
    input_schema: {
      type: 'object' as const,
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

