import { Composio } from '@composio/core';
import { LangchainProvider } from '@composio/langchain';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { initDatabase } from '../../db/sqlite';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

/**
 * Composio Service - Manages Composio Tool Router integration
 *
 * Provides access to 100+ SaaS integrations (Gmail, GitHub, Slack, etc.)
 * with in-chat OAuth authentication flows.
 */
export class ComposioService {
  private composio: Composio<LangchainProvider> | null = null;
  private session: any = null;
  private userId: string = '';
  private disabled: boolean = false;

  /**
   * Initialize the Composio service
   * Sets up the client, creates/retrieves user ID, and establishes session
   */
  async initialize(): Promise<void> {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      console.warn('[Composio] API key not configured (COMPOSIO_API_KEY). External integrations disabled.');
      this.disabled = true;
      return;
    }

    try {
      this.userId = this.getOrCreateUserId();

      this.composio = new Composio({
        apiKey,
        provider: new LangchainProvider()
      });

      await this.getOrCreateSession();
      console.log('[Composio] Initialized successfully for user:', this.userId);
    } catch (error) {
      console.error('[Composio] Failed to initialize:', error);
      this.disabled = true;
    }
  }

  /**
   * Get or create a machine-based user ID
   * Stored in SQLite settings for persistence across sessions
   */
  private getOrCreateUserId(): string {
    const db = initDatabase();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('composioUserId') as { value: string } | undefined;
    if (row?.value) {
      return row.value;
    }

    const newUserId = `faria_${uuidv4()}`;
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('composioUserId', newUserId);
    console.log('[Composio] Created new user ID:', newUserId);
    return newUserId;
  }

  /**
   * Get or create a Composio Tool Router session
   * Session enables access to all Composio tools with manage_connections enabled
   */
  async getOrCreateSession(): Promise<any> {
    if (this.disabled || !this.composio) {
      return null;
    }

    if (this.session) {
      return this.session;
    }

    try {
      // Create session with manage_connections enabled for in-chat OAuth
      this.session = await this.composio.create(this.userId, {
        manageConnections: true  // Enables COMPOSIO_MANAGE_CONNECTIONS meta-tool for OAuth
      });

      console.log('[Composio] Session created');
      return this.session;
    } catch (error) {
      console.error('[Composio] Failed to create session:', error);
      return null;
    }
  }

  /**
   * Get all available Composio tools formatted for LangChain
   * Returns DynamicStructuredTool instances that handle their own execution
   */
  async getTools(): Promise<DynamicStructuredTool[]> {
    if (this.disabled || !this.session) {
      return [];
    }

    try {
      const tools = await this.session.tools();
      console.log(`[Composio] Retrieved ${tools?.length || 0} tools`);
      return tools || [];
    } catch (error) {
      console.error('[Composio] Failed to get tools:', error);
      return [];
    }
  }

  /**
   * Check if the Composio service is disabled
   */
  isDisabled(): boolean {
    return this.disabled;
  }

  /**
   * Get the current user ID
   */
  getUserId(): string {
    return this.userId;
  }
}

// Export singleton instance for convenience
export const composioService = new ComposioService();
