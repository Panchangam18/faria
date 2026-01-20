import { Composio } from '@composio/core';
import { LangchainProvider } from '@composio/langchain';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { initDatabase } from '../../db/sqlite';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

/**
 * Format a slug into a proper display name
 * e.g., "googlecalendar" -> "Google Calendar", "perplexityai" -> "Perplexity AI"
 */
function formatDisplayName(slug: string): string {
  // Direct mappings for known apps with non-standard names
  const directMappings: Record<string, string> = {
    'perplexityai': 'Perplexity AI',
    'retellai': 'Retell AI',
    'openai': 'OpenAI',
    'googlecalendar': 'Google Calendar',
    'googledrive': 'Google Drive',
    'googlesheets': 'Google Sheets',
    'googledocs': 'Google Docs',
    'googlemeet': 'Google Meet',
    'googlemail': 'Google Mail',
    'github': 'GitHub',
    'gitlab': 'GitLab',
    'linkedin': 'LinkedIn',
    'youtube': 'YouTube',
    'mongodb': 'MongoDB',
    'mysql': 'MySQL',
    'postgresql': 'PostgreSQL',
    'chatgpt': 'ChatGPT',
    'dall-e': 'DALL-E',
    'hubspot': 'HubSpot',
    'mailchimp': 'Mailchimp',
    'salesforce': 'Salesforce',
    'zendesk': 'Zendesk',
    'clickup': 'ClickUp',
    'airtable': 'Airtable',
    'asana': 'Asana',
    'trello': 'Trello',
    'todoist': 'Todoist',
    'dropbox': 'Dropbox',
    'evernote': 'Evernote',
    'figma': 'Figma',
    'canva': 'Canva',
    'zapier': 'Zapier',
    'twilio': 'Twilio',
    'sendgrid': 'SendGrid',
    'stripe': 'Stripe',
    'shopify': 'Shopify',
    'woocommerce': 'WooCommerce',
    'typeform': 'Typeform',
    'calendly': 'Calendly',
    'intercom': 'Intercom',
    'freshdesk': 'Freshdesk',
    'pipedrive': 'Pipedrive',
    'monday': 'Monday.com',
    'notion': 'Notion',
    'coda': 'Coda',
    'miro': 'Miro',
    'loom': 'Loom',
    'zoom': 'Zoom',
    'webex': 'Webex',
    'discord': 'Discord',
    'telegram': 'Telegram',
    'whatsapp': 'WhatsApp',
    'twitter': 'Twitter',
    'facebook': 'Facebook',
    'instagram': 'Instagram',
    'tiktok': 'TikTok',
    'reddit': 'Reddit',
    'pinterest': 'Pinterest',
    'spotify': 'Spotify',
    'soundcloud': 'SoundCloud',
  };

  const lowerSlug = slug.toLowerCase();

  // Check direct mappings first
  if (directMappings[lowerSlug]) {
    return directMappings[lowerSlug];
  }

  // Common word mappings for splitting
  const wordMappings: Record<string, string> = {
    'ai': 'AI',
    'api': 'API',
    'aws': 'AWS',
    'gcp': 'GCP',
    'crm': 'CRM',
    'erp': 'ERP',
    'hr': 'HR',
    'io': 'IO',
    'db': 'DB',
    'sql': 'SQL',
    'oauth': 'OAuth',
    'sdk': 'SDK',
    'sms': 'SMS',
    'url': 'URL',
    'http': 'HTTP',
    'https': 'HTTPS',
    'ftp': 'FTP',
    'ssh': 'SSH',
    'vpn': 'VPN',
    'pdf': 'PDF',
    'csv': 'CSV',
    'json': 'JSON',
    'xml': 'XML',
  };

  // Try to split concatenated words
  let formatted = slug
    // Insert space before uppercase letters (camelCase)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Split before "ai" at the end
    .replace(/([a-z])(ai)$/i, '$1 $2')
    // Insert space before common suffixes
    .replace(/(calendar|drive|sheets|docs|mail|meet|chat|cloud|hub|lab|flow|desk|base|form|board|point|view|time|sync|box|bit|pad|note|task|work|space|dev|app|bot|pro|plus|go|io)$/gi, ' $1')
    // Clean up multiple spaces
    .replace(/\s+/g, ' ')
    .trim();

  // Capitalize each word and apply mappings
  formatted = formatted
    .split(' ')
    .map(word => {
      const lower = word.toLowerCase();
      if (wordMappings[lower]) {
        return wordMappings[lower];
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');

  return formatted;
}

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

  /**
   * Get the Composio client instance
   */
  getClient(): Composio<LangchainProvider> | null {
    return this.composio;
  }

  /**
   * Get all connected accounts for the current user
   * Returns only ACTIVE connections, deduplicated by app name
   */
  async getConnections(): Promise<Array<{
    id: string;
    appName: string;
    displayName: string;
    status: string;
    logo?: string;
    createdAt?: string;
  }>> {
    if (this.disabled || !this.composio) {
      return [];
    }

    try {
      // Get connections filtered to ACTIVE only
      const response = await this.composio.connectedAccounts.list({
        userIds: [this.userId],
        statuses: ['ACTIVE']
      });

      // Get toolkits to look up logos and display names
      const toolkits = await this.composio.toolkits.get();
      const toolkitMap = new Map<string, { logo?: string; name: string }>();
      (toolkits || []).forEach((t: any) => {
        toolkitMap.set(t.slug, { logo: t.meta?.logo, name: t.name });
      });

      // Deduplicate by appName (keep first/most recent connection per app)
      const seen = new Set<string>();
      const connections: Array<{
        id: string;
        appName: string;
        displayName: string;
        status: string;
        logo?: string;
        createdAt?: string;
      }> = [];

      for (const conn of (response.items || [])) {
        const appName = conn.toolkit?.slug || 'Unknown';
        if (!seen.has(appName)) {
          seen.add(appName);
          const toolkitInfo = toolkitMap.get(appName);
          connections.push({
            id: conn.id,
            appName,
            displayName: toolkitInfo?.name || formatDisplayName(appName),
            status: conn.status || 'active',
            logo: toolkitInfo?.logo,
            createdAt: conn.createdAt
          });
        }
      }

      return connections;
    } catch (error) {
      console.error('[Composio] Failed to get connections:', error);
      return [];
    }
  }

  /**
   * Delete/revoke a connected account
   */
  async deleteConnection(connectionId: string): Promise<boolean> {
    if (this.disabled || !this.composio) {
      return false;
    }

    try {
      await this.composio.connectedAccounts.delete(connectionId);
      console.log('[Composio] Connection deleted:', connectionId);
      return true;
    } catch (error) {
      console.error('[Composio] Failed to delete connection:', error);
      return false;
    }
  }

  /**
   * Get all available apps/integrations from Composio
   */
  async getAvailableApps(): Promise<Array<{
    name: string;
    displayName: string;
    logo?: string;
    categories?: string[];
  }>> {
    if (this.disabled || !this.composio) {
      return [];
    }

    try {
      // toolkits.get() returns an array directly
      const toolkits = await this.composio.toolkits.get();

      return (toolkits || []).map((toolkit: any) => ({
        name: toolkit.slug,
        displayName: toolkit.name || toolkit.slug,
        logo: toolkit.meta?.logo,
        categories: toolkit.meta?.categories?.map((c: any) => c.name) || []
      }));
    } catch (error) {
      console.error('[Composio] Failed to get available apps:', error);
      return [];
    }
  }

  /**
   * Initiate OAuth connection for an app
   * Returns the redirect URL for the user to complete authentication
   */
  async initiateConnection(appName: string): Promise<{ redirectUrl: string } | null> {
    if (this.disabled || !this.composio) {
      return null;
    }

    try {
      // Use toolkits.authorize() to generate a Connect Link
      const connectionRequest = await this.composio.toolkits.authorize(this.userId, appName);

      if (connectionRequest?.redirectUrl) {
        return {
          redirectUrl: connectionRequest.redirectUrl
        };
      }

      return null;
    } catch (error) {
      console.error('[Composio] Failed to initiate connection:', error);
      return null;
    }
  }
}

// Export singleton instance for convenience
export const composioService = new ComposioService();
