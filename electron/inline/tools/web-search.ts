import { ToolExecutionResult } from './types';

/**
 * Execute web search tool
 */
export async function executeWebSearch(
  query: string,
  sendStatus: (status: string) => void
): Promise<ToolExecutionResult> {
  sendStatus('Searching the web...');
  
  try {
    // Use DuckDuckGo instant answer API (no key needed)
    const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const response = await fetch(searchUrl);
    const data = await response.json();
    
    let resultText = '';
    
    if (data.AbstractText) {
      resultText = data.AbstractText;
    } else if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      resultText = data.RelatedTopics
        .slice(0, 3)
        .filter((t: any) => t.Text)
        .map((t: any) => t.Text)
        .join('\n');
    }
    
    if (!resultText) {
      resultText = `No instant results for "${query}". Try being more specific.`;
    }
    
    return {
      output: resultText,
      terminal: false,
      result: { type: 'answer', content: resultText }
    };
  } catch (e) {
    return {
      output: `Search failed: ${e}`,
      terminal: false,
      result: { type: 'error', content: `Search failed: ${e}` }
    };
  }
}

