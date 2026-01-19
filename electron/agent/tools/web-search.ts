import { ToolResult } from './types';

/**
 * Search the web using Serper API (Google Search)
 * Requires SERPER_API_KEY environment variable
 */
export async function webSearch(params: { query: string }): Promise<ToolResult> {
  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    return { success: false, error: 'Serper API key not configured in .env (SERPER_API_KEY)' };
  }

  try {
    const response = await fetch('https://google.serper.dev/search', {
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

    let resultText = '';

    // Include answer box if present
    if (data.answerBox?.answer) {
      resultText += `Answer: ${data.answerBox.answer}\n\n`;
    } else if (data.answerBox?.snippet) {
      resultText += `Answer: ${data.answerBox.snippet}\n\n`;
    }

    // Include organic results
    if (data.organic && data.organic.length > 0) {
      const results = data.organic.slice(0, 5).map((r: { title: string; snippet: string; link: string }) =>
        `${r.title}\n${r.snippet}\n${r.link}`
      ).join('\n\n');
      resultText += results;
    }

    if (!resultText) {
      return { success: false, error: `No results found for "${params.query}"` };
    }

    return { success: true, result: resultText };
  } catch (e) {
    return { success: false, error: `Search failed: ${e}` };
  }
}
