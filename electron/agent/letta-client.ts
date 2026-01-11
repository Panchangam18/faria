import { initDatabase } from '../db/sqlite';

const LETTA_API_URL = 'https://api.letta.ai/v1';

interface LettaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface LettaAgent {
  id: string;
  name: string;
  created_at: string;
}

interface LettaResponse {
  messages: Array<{
    role: string;
    content: string;
  }>;
}

/**
 * Letta API Client for memory management
 * Provides persistent memory and context windowing for the agent
 */
export class LettaClient {
  private apiKey: string;
  private agentId: string | null = null;
  private agentName = 'faria-agent';
  
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }
  
  /**
   * Initialize or get existing agent
   */
  async initialize(): Promise<void> {
    // Check if we have a stored agent ID
    const db = initDatabase();
    const stored = db.prepare('SELECT value FROM settings WHERE key = ?').get('letta_agent_id') as { value: string } | undefined;
    
    if (stored?.value) {
      this.agentId = stored.value;
      return;
    }
    
    // Create new agent
    try {
      const agent = await this.createAgent();
      this.agentId = agent.id;
      
      // Store agent ID
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('letta_agent_id', agent.id);
    } catch (error) {
      console.error('Failed to initialize Letta agent:', error);
      // Continue without Letta - use local fallback
    }
  }
  
  /**
   * Create a new Letta agent
   */
  private async createAgent(): Promise<LettaAgent> {
    const response = await fetch(`${LETTA_API_URL}/agents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: this.agentName,
        model: 'claude-3-5-sonnet-20241022',
        system: `You are Faria, an intelligent computer assistant that helps users with tasks on their Mac.
You have the ability to see the current state of applications and take actions like clicking, typing, and running scripts.
You learn and improve over time, creating custom tools to optimize workflows.
Be concise and efficient in your responses. Take action when appropriate rather than just explaining.`,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to create Letta agent: ${response.statusText}`);
    }
    
    return response.json();
  }
  
  /**
   * Send a message to Letta and get response with memory context
   */
  async sendMessage(message: string, systemContext?: string): Promise<string> {
    if (!this.agentId) {
      // Fallback to stateless mode
      return this.fallbackResponse(message);
    }
    
    try {
      const messages: LettaMessage[] = [];
      
      if (systemContext) {
        messages.push({
          role: 'system',
          content: systemContext,
        });
      }
      
      messages.push({
        role: 'user',
        content: message,
      });
      
      const response = await fetch(`${LETTA_API_URL}/agents/${this.agentId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages }),
      });
      
      if (!response.ok) {
        throw new Error(`Letta API error: ${response.statusText}`);
      }
      
      const data: LettaResponse = await response.json();
      
      // Extract assistant response
      const assistantMessage = data.messages.find(m => m.role === 'assistant');
      return assistantMessage?.content || 'No response from Letta.';
    } catch (error) {
      console.error('Letta API error:', error);
      return this.fallbackResponse(message);
    }
  }
  
  /**
   * Get memory context for the agent
   */
  async getContext(): Promise<string> {
    if (!this.agentId) {
      return '';
    }
    
    try {
      const response = await fetch(`${LETTA_API_URL}/agents/${this.agentId}/memory`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });
      
      if (!response.ok) {
        return '';
      }
      
      const data = await response.json();
      return data.context || '';
    } catch {
      return '';
    }
  }
  
  /**
   * Update memory with new information
   */
  async updateMemory(query: string, response: string): Promise<void> {
    if (!this.agentId) {
      return;
    }
    
    try {
      await fetch(`${LETTA_API_URL}/agents/${this.agentId}/memory`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          human: `User query: ${query}`,
          assistant: `Response: ${response}`,
        }),
      });
    } catch (error) {
      console.error('Failed to update Letta memory:', error);
    }
  }
  
  /**
   * Fallback response when Letta is unavailable
   */
  private fallbackResponse(_message: string): string {
    return '';
  }
  
  /**
   * Check if Letta is properly configured
   */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }
}

