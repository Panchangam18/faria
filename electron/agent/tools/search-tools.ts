import { ToolResult } from './types';
import { initDatabase } from '../../db/sqlite';

export interface SearchToolsParams {
  query: string;
  type?: 'bm25' | 'grep';
}

export async function searchTools(params: SearchToolsParams): Promise<ToolResult> {
  const db = initDatabase();
  const tools = db.prepare('SELECT id, name, description FROM custom_tools').all() as Array<{
    id: string;
    name: string;
    description: string;
  }>;
  
  const searchType = params.type || 'bm25';
  let matches: typeof tools;
  
  if (searchType === 'grep') {
    const regex = new RegExp(params.query, 'i');
    matches = tools.filter(t => regex.test(t.name) || regex.test(t.description));
  } else {
    // Simple BM25-like scoring
    const queryTerms = params.query.toLowerCase().split(/\s+/);
    const scored = tools.map(t => {
      const text = `${t.name} ${t.description}`.toLowerCase();
      const score = queryTerms.reduce((sum, term) => {
        return sum + (text.includes(term) ? 1 : 0);
      }, 0);
      return { ...t, score };
    });
    matches = scored.filter(t => t.score > 0).sort((a, b) => b.score - a.score);
  }
  
  if (matches.length === 0) {
    return { success: true, result: 'No matching tools found.' };
  }
  
  const result = matches.slice(0, 5).map(t => `- ${t.name}: ${t.description}`).join('\n');
  return { success: true, result };
}

