import { tool } from '@langchain/core/tools';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { ToolResult } from './types';

// Zod schema for the tool
export const WebSearchSchema = z.object({
  query: z.string().describe('The search query'),
});

/**
 * Factory function to create the web search tool
 * Search the web using Serper API (Google Search)
 * Requires SERPER_API_KEY environment variable
 */
export function createWebSearchTool(): DynamicStructuredTool {
  return tool(
    async (input) => {
      const serperKey = process.env.SERPER_API_KEY;
      if (!serperKey) {
        throw new Error('Serper API key not configured in .env (SERPER_API_KEY)');
      }

      try {
        const response = await fetch('https://google.serper.dev/search', {
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
          throw new Error(`No results found for "${input.query}"`);
        }

        return resultText;
      } catch (e) {
        throw new Error(`Search failed: ${e}`);
      }
    },
    {
      name: 'web_search',
      description: 'Search the web for information using DuckDuckGo. Returns facts and information.',
      schema: WebSearchSchema,
    }
  );
}

// Legacy function for backward compatibility during migration
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
