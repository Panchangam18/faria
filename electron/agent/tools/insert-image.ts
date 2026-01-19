import { insertImageFromUrl } from '../../services/text-extraction';
import { ToolResult, ToolContext } from './types';

/**
 * Search Google Images and insert the best result at cursor position
 * Requires SERPER_API_KEY environment variable
 */
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
