import { Composio } from '@composio/core';
import { LangchainProvider } from '@composio/langchain';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
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
 * Toolkit slug -> tool that returns identifying info (email, username, etc.)
 * Used to fetch account labels when Composio redacts tokens.
 */
const PROFILE_TOOLS: Record<string, { tool: string; field: string }> = {
  'gmail': { tool: 'GMAIL_GET_PROFILE', field: 'emailAddress' },
  'github': { tool: 'GITHUB_GET_AUTHENTICATED_USER', field: 'login' },
  'slack': { tool: 'SLACK_AUTH_TEST', field: 'user' },
};

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
   * Get all available Composio tools formatted for LangChain.
   * Each tool is wrapped to accept an optional `connected_account_id` parameter,
   * allowing the agent to target a specific account when multiple are connected.
   */
  async getTools(): Promise<DynamicStructuredTool[]> {
    if (this.disabled || !this.session || !this.composio) {
      return [];
    }

    try {
      const sessionTools: DynamicStructuredTool[] = await this.session.tools();
      if (!sessionTools?.length) return [];

      const wrapped = sessionTools.map((tool) => {
        // COMPOSIO_* meta-tools (search, manage, multi-execute, workbench, etc.)
        // must keep their session-based executor — they don't exist in the direct API
        if (tool.name.startsWith('COMPOSIO_')) {
          return tool;
        }

        // Extend the schema with connected_account_id
        const originalSchema = tool.schema as z.ZodObject<any>;
        const extendedSchema = originalSchema.extend({
          connected_account_id: z.string().optional().describe(
            'Optional: the connected account ID to use. Pass this to target a specific account when the user has multiple accounts connected for this integration.'
          ),
        });

        const composio = this.composio!;
        const userId = this.userId;

        return new DynamicStructuredTool({
          name: tool.name,
          description: tool.description,
          schema: extendedSchema,
          func: async (args: Record<string, unknown>) => {
            const { connected_account_id, ...toolArgs } = args;
            const result = await composio.tools.execute(tool.name, {
              userId,
              connectedAccountId: connected_account_id as string | undefined,
              dangerouslySkipVersionCheck: true,
              arguments: toolArgs,
            });
            return JSON.stringify(result);
          },
        });
      });

      console.log(`[Composio] Retrieved ${wrapped.length} tools (with account selection)`);
      return wrapped;
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
   * Returns only ACTIVE connections with account labels for disambiguation
   */
  async getConnections(): Promise<Array<{
    id: string;
    appName: string;
    displayName: string;
    status: string;
    logo?: string;
    createdAt?: string;
    accountLabel?: string;
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

      const connections: Array<{
        id: string;
        appName: string;
        displayName: string;
        status: string;
        logo?: string;
        createdAt?: string;
        accountLabel?: string;
      }> = [];

      for (const conn of (response.items || [])) {
        const appName = conn.toolkit?.slug || 'Unknown';
        const toolkitInfo = toolkitMap.get(appName);
        connections.push({
          id: conn.id,
          appName,
          displayName: toolkitInfo?.name || formatDisplayName(appName),
          status: conn.status || 'active',
          logo: toolkitInfo?.logo,
          createdAt: conn.createdAt,
        });
      }

      // Count connections per app
      const appCounts = new Map<string, number>();
      connections.forEach(c => appCounts.set(c.appName, (appCounts.get(c.appName) || 0) + 1));

      // For duplicate apps, fetch identifying info via profile tools
      const duplicates = connections.filter(c => (appCounts.get(c.appName) || 1) > 1);
      if (duplicates.length > 0 && this.composio) {
        await Promise.all(duplicates.map(async (conn) => {
          const profileTool = PROFILE_TOOLS[conn.appName];
          if (!profileTool) return;
          try {
            const result = await this.composio!.tools.execute(profileTool.tool, {
              connectedAccountId: conn.id,
              userId: this.userId,
              dangerouslySkipVersionCheck: true,
              arguments: {},
            });
            // Extract the identifying field from the response
            const data = result?.data || result;
            if (data && typeof data === 'object') {
              const value = (data as Record<string, any>)[profileTool.field];
              if (typeof value === 'string' && value.length > 0) {
                conn.accountLabel = value;
              }
            }
          } catch (err) {
            console.warn(`[Composio] Failed to get profile for ${conn.appName}:`, err);
          }
        }));

        // Number any still-unlabeled duplicates
        const appCounters = new Map<string, number>();
        for (const conn of duplicates) {
          if (!conn.accountLabel) {
            const num = (appCounters.get(conn.appName) || 0) + 1;
            appCounters.set(conn.appName, num);
            conn.accountLabel = `Account ${num}`;
          }
        }
      }

      // Sort by app name so multiple accounts for the same app appear grouped
      connections.sort((a, b) => {
        const nameCompare = a.appName.localeCompare(b.appName);
        if (nameCompare !== 0) return nameCompare;
        return (a.createdAt || '').localeCompare(b.createdAt || '');
      });

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
