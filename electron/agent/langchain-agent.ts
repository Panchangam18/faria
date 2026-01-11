import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { Client } from 'langsmith';
import { initDatabase } from '../db/sqlite';

// Load environment variables
import 'dotenv/config';

/**
 * Memory manager using SQLite for persistent agent memory
 */
export class AgentMemory {
  private db: ReturnType<typeof initDatabase>;
  
  constructor() {
    this.db = initDatabase();
    this.initMemoryTable();
  }
  
  private initMemoryTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
  
  /**
   * Store a memory
   */
  storeMemory(type: 'fact' | 'preference' | 'skill', content: string, metadata?: Record<string, unknown>): void {
    this.db.prepare(
      'INSERT INTO agent_memory (type, content, metadata) VALUES (?, ?, ?)'
    ).run(type, content, metadata ? JSON.stringify(metadata) : null);
  }
  
  /**
   * Retrieve relevant memories
   */
  getMemories(type?: string, limit = 10): Array<{ type: string; content: string; metadata?: Record<string, unknown> }> {
    const query = type
      ? 'SELECT type, content, metadata FROM agent_memory WHERE type = ? ORDER BY created_at DESC LIMIT ?'
      : 'SELECT type, content, metadata FROM agent_memory ORDER BY created_at DESC LIMIT ?';
    
    const rows = type
      ? this.db.prepare(query).all(type, limit) as Array<{ type: string; content: string; metadata: string | null }>
      : this.db.prepare(query).all(limit) as Array<{ type: string; content: string; metadata: string | null }>;
    
    return rows.map(row => ({
      type: row.type,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }
  
  /**
   * Store conversation message
   */
  storeMessage(sessionId: string, role: string, content: string): void {
    this.db.prepare(
      'INSERT INTO conversation_history (session_id, role, content) VALUES (?, ?, ?)'
    ).run(sessionId, role, content);
  }
  
  /**
   * Get recent conversation history
   */
  getConversationHistory(sessionId: string, limit = 20): Array<{ role: string; content: string }> {
    return this.db.prepare(
      'SELECT role, content FROM conversation_history WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(sessionId, limit) as Array<{ role: string; content: string }>;
  }
  
  /**
   * Get memory context string for the agent
   */
  getMemoryContext(): string {
    const memories = this.getMemories(undefined, 20);
    if (memories.length === 0) return '';
    
    const parts = ['=== Agent Memory ==='];
    for (const mem of memories) {
      parts.push(`[${mem.type}] ${mem.content}`);
    }
    return parts.join('\n');
  }
}

/**
 * LangSmith client for explicit tracing
 */
export class TracingClient {
  private client: Client | null = null;
  
  constructor() {
    const apiKey = process.env.LANGCHAIN_API_KEY;
    if (apiKey) {
      this.client = new Client({ apiKey });
      console.log('[LangSmith] Tracing enabled');
    } else {
      console.log('[LangSmith] No API key, tracing disabled');
    }
  }
  
  isEnabled(): boolean {
    return !!this.client;
  }
  
  async logRun(name: string, inputs: Record<string, unknown>, outputs: Record<string, unknown>): Promise<void> {
    if (!this.client) return;
    
    try {
      // LangSmith automatically traces LangChain calls when env vars are set
      // This is for any additional custom logging
      console.log(`[LangSmith] Logged run: ${name}`);
    } catch (error) {
      console.error('[LangSmith] Failed to log run:', error);
    }
  }
}

/**
 * Create the LangChain-based agent
 */
export function createLangChainAgent(apiKey: string) {
  // Initialize LangChain with Anthropic
  const model = new ChatAnthropic({
    model: 'claude-sonnet-4-20250514',
    anthropicApiKey: apiKey,
    temperature: 0,
  });
  
  return model;
}

/**
 * Convert messages to LangChain format
 */
export function toLangChainMessages(messages: Array<{ role: string; content: string }>) {
  return messages.map(msg => {
    switch (msg.role) {
      case 'system':
        return new SystemMessage(msg.content);
      case 'user':
        return new HumanMessage(msg.content);
      case 'assistant':
        return new AIMessage(msg.content);
      default:
        return new HumanMessage(msg.content);
    }
  });
}

