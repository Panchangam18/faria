import { ToolResult } from './types';

/**
 * Search the web using DuckDuckGo Instant Answer API
 * No API key required
 */
export async function webSearch(params: { query: string }): Promise<ToolResult> {
  try {
    const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(params.query)}&format=json&no_html=1`;
    const response = await fetch(searchUrl);
    const data = await response.json();

    let resultText = '';

    if (data.AbstractText) {
      resultText = data.AbstractText;
    } else if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      resultText = data.RelatedTopics
        .slice(0, 3)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((t: any) => t.Text)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((t: any) => t.Text)
        .join('\n');
    }

    if (!resultText) {
      resultText = `No instant results for "${params.query}". Try being more specific.`;
    }

    return { success: true, result: resultText };
  } catch (e) {
    return { success: false, error: `Search failed: ${e}` };
  }
}
