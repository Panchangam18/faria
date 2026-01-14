import { insertImageFromUrl } from '../../services/text-extraction';
import { ToolExecutionResult } from './types';

/**
 * Execute insert image tool
 */
export async function executeInsertImage(
  query: string,
  targetApp: string | null,
  sendStatus: (status: string) => void
): Promise<ToolExecutionResult> {
  sendStatus('Searching for image...');
  
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    return {
      output: 'Serper API key not configured',
      terminal: true,
      result: { type: 'error', content: 'Serper API key not configured in .env' }
    };
  }
  
  let imageUrl: string;
  try {
    const response = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: {
        'X-API-KEY': serperKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ q: query, num: 5 })
    });
    
    if (!response.ok) {
      throw new Error(`Serper API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.images || data.images.length === 0) {
      return {
        output: `No images found for "${query}"`,
        terminal: true,
        result: { type: 'error', content: `No images found for "${query}"` }
      };
    }
    
    imageUrl = data.images[0].imageUrl;
  } catch (e) {
    return {
      output: `Image search failed: ${e}`,
      terminal: true,
      result: { type: 'error', content: `Image search failed: ${e}` }
    };
  }
  
  sendStatus('Inserting image...');
  const result = await insertImageFromUrl(targetApp, imageUrl);
  
  if (result.success) {
    return {
      output: 'Image inserted',
      terminal: true,
      result: { type: 'image', content: 'Image inserted', imageUrl }
    };
  } else {
    return {
      output: `Failed to insert image: ${result.error}`,
      terminal: true,
      result: { type: 'error', content: result.error || 'Failed to insert image' }
    };
  }
}

