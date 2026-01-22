import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { insertImageFromUrl } from '../../services/text-extraction';
import { ToolResult, ToolContext } from './types';

// Zod schema for the tool
export const InsertImageSchema = z.object({
  query: z.string().describe('Image search query'),
});

/**
 * Factory function that creates the insert image tool with context injected
 * Search Google Images and insert the best result at cursor position
 * Requires SERPER_API_KEY environment variable
 */
export function createInsertImageTool(context: ToolContext): DynamicStructuredTool {
  return tool(
    async (input) => {
      const serperKey = process.env.SERPER_API_KEY;
      if (!serperKey) {
        throw new Error('Serper API key not configured in .env (SERPER_API_KEY)');
      }

      let imageUrl: string;
      try {
        const response = await fetch('https://google.serper.dev/images', {
          method: 'POST',
          headers: {
            'X-API-KEY': serperKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ q: input.query, num: 5 })
        });

        if (!response.ok) {
          throw new Error(`Serper API error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.images || data.images.length === 0) {
          throw new Error(`No images found for "${input.query}"`);
        }

        imageUrl = data.images[0].imageUrl;
      } catch (e) {
        throw new Error(`Image search failed: ${e}`);
      }

      const result = await insertImageFromUrl(context.targetApp, imageUrl);

      if (result.success) {
        return `Image inserted: ${imageUrl}`;
      } else {
        throw new Error(result.error || 'Failed to insert image');
      }
    },
    {
      name: 'insert_image',
      description: 'Search Google Images and insert the best result at cursor position.',
      schema: InsertImageSchema,
    }
  );
}

// Legacy function for backward compatibility during migration
export async function insertImage(
  params: { query: string },
  context: ToolContext
): Promise<ToolResult> {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    return { success: false, error: 'Serper API key not configured in .env (SERPER_API_KEY)' };
  }

  let imageUrl: string;
  try {
    const response = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': serperKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: params.query, num: 5 })
    });

    if (!response.ok) {
      return { success: false, error: `Serper API error: ${response.status}` };
    }

    const data = await response.json();

    if (!data.images || data.images.length === 0) {
      return { success: false, error: `No images found for "${params.query}"` };
    }

    imageUrl = data.images[0].imageUrl;
  } catch (e) {
    return { success: false, error: `Image search failed: ${e}` };
  }

  const result = await insertImageFromUrl(context.targetApp, imageUrl);

  if (result.success) {
    return { success: true, result: `Image inserted: ${imageUrl}` };
  } else {
    return { success: false, error: result.error || 'Failed to insert image' };
  }
}
