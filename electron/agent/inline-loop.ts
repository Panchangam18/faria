/**
 * Inline Agent Loop
 * A lightweight agent for the inline command bar with limited capabilities:
 * 1. Web search to answer questions
 * 2. Text edits within the blast radius
 * 3. Image insertion from web
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';
import { initDatabase } from '../db/sqlite';
import { applyTextEdits, insertImageFromUrl, TextEdit } from '../services/text-extraction';

// Load environment variables
config();

interface InlineAgentConfig {
  model: string;
  maxTokens: number;
}

const DEFAULT_CONFIG: InlineAgentConfig = {
  model: 'claude-sonnet-4-20250514',
  maxTokens: 1024,
};

const INLINE_SYSTEM_PROMPT = `You are Faria Inline, a focused text assistant. You help with:

1. **Edit selected text** - When given selected text, replace it with improved/expanded/modified version.
2. **Answer questions** - Use web_search to find information and give brief, direct answers.
3. **Insert images** - Find and insert images into documents.

IMPORTANT RULES:
- The user has SELECTED TEXT in their document. Your edits will REPLACE their selection.
- For edits: use suggest_edits with the full replacement text. The newText completely replaces the selection.
- Be concise but thorough. Match the style/tone of the original text.
- For questions without edits: just use answer() to respond.
- For images: use insert_image with a DETAILED description to find and insert the best matching image.

You have these tools:
- suggest_edits(edits) - Replace the selected text. Use [{oldText: <selected text>, newText: <your replacement>}]
- web_search(query) - Search the web for facts/information
- insert_image(query) - Search for and insert an image. Provide a DETAILED description for best results.
- answer(text) - Just respond with text (no action needed)

Context about what you're working with:
- "contextText" is the TEXT THE USER HAS SELECTED in their document (may be empty for image insertion)
- When asked to edit/expand/improve/fix, replace the selection with your improved version
- When asked a question about the text, use answer() to respond

Examples:
- User selects "The cat sat" and asks "expand this" → suggest_edits([{oldText: "The cat sat", newText: "The fluffy orange cat sat lazily on the warm windowsill, watching birds flutter by"}])
- User selects "teh quick fox" and asks "fix typos" → suggest_edits([{oldText: "teh quick fox", newText: "the quick fox"}])
- User selects some text and asks "what does this mean?" → answer with explanation (no edits)
- User asks "add a picture of a sunset" → insert_image("beautiful sunset over ocean")`;

// Tool definitions for Anthropic API
const INLINE_TOOLS: Anthropic.Tool[] = [
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

export interface InlineResult {
  type: 'answer' | 'edits' | 'image' | 'error';
  content: string;
  edits?: TextEdit[];
  imageUrl?: string;
}

export class InlineAgentLoop {
  private client: Anthropic | null = null;
  private config: InlineAgentConfig;
  private onStatus: ((status: string) => void) | null = null;
  
  constructor() {
    this.config = DEFAULT_CONFIG;
    this.initializeClient();
  }
  
  private initializeClient(): void {
    const db = initDatabase();
    const anthropicKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('anthropicKey') as { value: string } | undefined;
    
    if (anthropicKey?.value) {
      this.client = new Anthropic({
        apiKey: anthropicKey.value
      });
    }
  }
  
  setStatusCallback(callback: (status: string) => void): void {
    this.onStatus = callback;
  }
  
  private sendStatus(status: string): void {
    if (this.onStatus) {
      this.onStatus(status);
    }
  }
  
  /**
   * Run the inline agent
   */
  async run(
    query: string, 
    contextText: string | null,
    targetApp: string | null
  ): Promise<InlineResult> {
    if (!this.client) {
      this.initializeClient();
      if (!this.client) {
        return { type: 'error', content: 'API key not configured. Add your Anthropic key in Settings.' };
      }
    }
    
    // Build the user message with context
    let userMessage = query;
    if (contextText) {
      userMessage = `Context text around cursor (${contextText.split(/\s+/).length} words):\n\`\`\`\n${contextText}\n\`\`\`\n\nUser request: ${query}`;
    }
    
    this.sendStatus('Thinking...');
    
    try {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: userMessage }
      ];
      
      // First API call
      let response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: INLINE_SYSTEM_PROMPT,
        tools: INLINE_TOOLS,
        messages
      });
      
      // Handle tool use
      while (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );
        
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        
        for (const toolUse of toolUseBlocks) {
          const result = await this.executeTool(toolUse.name, toolUse.input, targetApp, contextText);
          
          // If this is a terminal action (edits, image, answer), return immediately
          if (result.terminal) {
            return result.result;
          }
          
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result.output
          });
        }
        
        // Continue conversation with tool results
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
        
        response = await this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system: INLINE_SYSTEM_PROMPT,
          tools: INLINE_TOOLS,
          messages
        });
      }
      
      // Extract final text response
      const textBlock = response.content.find(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      
      return {
        type: 'answer',
        content: textBlock?.text || 'Done.'
      };
      
    } catch (error) {
      console.error('[InlineAgent] Error:', error);
      return { type: 'error', content: String(error) };
    }
  }
  
  /**
   * Execute a tool and return the result
   */
  private async executeTool(
    name: string, 
    input: unknown,
    targetApp: string | null,
    contextText: string | null
  ): Promise<{ output: string; terminal: boolean; result: InlineResult }> {
    const params = input as Record<string, unknown>;
    
    switch (name) {
      case 'web_search': {
        this.sendStatus('Searching the web...');
        const query = params.query as string;
        
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
      
      case 'suggest_edits': {
        this.sendStatus('Applying edits...');
        const edits = params.edits as TextEdit[];
        
        const result = await applyTextEdits(targetApp, edits);
        
        if (result.success) {
          return {
            output: `Applied ${result.appliedCount} edit(s)`,
            terminal: true,
            result: { 
              type: 'edits', 
              content: `Applied ${result.appliedCount} edit(s)`,
              edits 
            }
          };
        } else {
          return {
            output: `Edit errors: ${result.errors.join(', ')}`,
            terminal: true,
            result: { 
              type: 'error', 
              content: result.errors.join(', ') 
            }
          };
        }
      }
      
      case 'insert_image': {
        const query = params.query as string;
        this.sendStatus('Searching for image...');
        
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
        
        this.sendStatus('Inserting image...');
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
      
      case 'answer': {
        const text = params.text as string;
        return {
          output: text,
          terminal: true,
          result: { type: 'answer', content: text }
        };
      }
      
      default:
        return {
          output: `Unknown tool: ${name}`,
          terminal: false,
          result: { type: 'error', content: `Unknown tool: ${name}` }
        };
    }
  }
}

// Singleton instance
let inlineAgent: InlineAgentLoop | null = null;

export function getInlineAgent(): InlineAgentLoop {
  if (!inlineAgent) {
    inlineAgent = new InlineAgentLoop();
  }
  return inlineAgent;
}

