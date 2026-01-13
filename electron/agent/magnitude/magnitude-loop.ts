/**
 * Magnitude Agent Loop - Vision-first computer use agent
 * Uses Magnitude framework with Claude 4 Sonnet for desktop automation
 */

import { Agent, DesktopConnector, LLMClient } from 'magnitude-core';
import { BrowserWindow } from 'electron';
import { HybridMacInterface } from './mac-interface';
import { initDatabase } from '../../db/sqlite';

const SYSTEM_PROMPT = `You are Faria, a vision-first computer automation agent running on macOS.

CRITICAL RULES:
1. ALWAYS take action immediately. Do not ask for clarification.
2. You can see the screen through screenshots - use visual understanding to locate elements.
3. Click on UI elements by their visual position, not by text parsing.
4. Be concise - one sentence max after completing an action.

CAPABILITIES:
- click(x, y) - Click at screen coordinates
- doubleClick(x, y) - Double-click
- rightClick(x, y) - Right-click for context menus
- type(text) - Type text at current cursor position
- key(key) - Press a key (return, tab, escape, etc.)
- hotkey([modifiers..., key]) - Press key combo like ["cmd", "c"]
- scroll(x, y, deltaX, deltaY) - Scroll at position
- drag(fromX, fromY, toX, toY) - Drag from one point to another

WORKFLOW:
1. Observe the screenshot to understand the current state
2. Identify the UI element to interact with
3. Execute the action at the correct coordinates
4. Verify the result

DO NOT: Ask questions, explain your reasoning, or describe what you see.
DO: Take action immediately and report success/failure briefly.`;

interface MagnitudeAgentConfig {
  model: string;
  temperature: number;
  promptCaching: boolean;
}

const DEFAULT_CONFIG: MagnitudeAgentConfig = {
  model: 'claude-sonnet-4-20250514',
  temperature: 0,
  promptCaching: true,
};

/**
 * Magnitude Agent Loop
 * Vision-first desktop automation using Magnitude framework
 */
export class MagnitudeAgentLoop {
  private agent: Agent | null = null;
  private desktopInterface: HybridMacInterface;
  private config: MagnitudeAgentConfig;
  private isRunning = false;
  private shouldCancel = false;
  
  constructor() {
    this.desktopInterface = new HybridMacInterface();
    this.config = DEFAULT_CONFIG;
  }
  
  /**
   * Initialize the Magnitude agent with Anthropic API key
   */
  private async initializeAgent(): Promise<void> {
    const db = initDatabase();
    
    // Get Anthropic API key from settings
    const anthropicKey = db.prepare('SELECT value FROM settings WHERE key = ?').get('anthropicKey') as { value: string } | undefined;
    
    if (!anthropicKey?.value) {
      throw new Error('Anthropic API key not configured. Please add it in Settings.');
    }
    
    // Configure Anthropic as the LLM client
    const llmClient: LLMClient = {
      provider: 'anthropic',
      options: {
        model: this.config.model,
        apiKey: anthropicKey.value,
        temperature: this.config.temperature,
        promptCaching: this.config.promptCaching,
      },
    };
    
    // Create desktop connector with our Mac interface
    const desktopConnector = new DesktopConnector({
      desktopInterface: this.desktopInterface,
    });
    
    // Create the Magnitude agent
    this.agent = new Agent({
      llm: llmClient,
      connectors: [desktopConnector],
      prompt: SYSTEM_PROMPT,
      telemetry: false, // Disable telemetry for privacy
    });
    
    // Set up event listeners for status updates
    this.setupEventListeners();
    
    // Start the agent (initializes connectors)
    await this.agent.start();
    
    console.log('[Magnitude] Agent initialized with Claude 4 Sonnet');
  }
  
  /**
   * Set up event listeners for agent status updates
   */
  private setupEventListeners(): void {
    if (!this.agent) return;
    
    this.agent.events.on('actionStarted', (action) => {
      const actionName = action.name || 'action';
      this.sendStatus(`Executing: ${actionName}...`);
      console.log('[Magnitude] Action start:', actionName);
    });
    
    this.agent.events.on('actionDone', (action) => {
      console.log('[Magnitude] Action complete:', action.name);
    });
    
    this.agent.events.on('thought', (thought) => {
      console.log('[Magnitude] Thought:', thought);
    });
    
    this.agent.events.on('actStarted', (task) => {
      this.sendStatus('Observing screen...');
      console.log('[Magnitude] Act started:', task);
    });
  }
  
  /**
   * Run the agent for a user query
   */
  async run(query: string, targetApp?: string | null): Promise<string> {
    if (this.isRunning) {
      throw new Error('Agent is already running');
    }
    
    this.isRunning = true;
    this.shouldCancel = false;
    
    console.log(`[Magnitude] Starting agent run with query: "${query.slice(0, 50)}..." targetApp: ${targetApp}`);
    
    try {
      // Initialize or reinitialize agent (picks up any API key changes)
      await this.initializeAgent();
      
      if (!this.agent) {
        throw new Error('Failed to initialize Magnitude agent');
      }
      
      // Focus the target app if specified
      if (targetApp) {
        this.sendStatus(`Focusing ${targetApp}...`);
        try {
          await this.desktopInterface.openApp(targetApp);
        } catch (e) {
          console.log('[Magnitude] Could not focus app:', targetApp, e);
        }
      }
      
      this.sendStatus('Thinking...');
      
      // Execute the task using Magnitude's act method
      await this.agent.act(query);
      
      const response = 'Task completed.';
      
      // Save to history
      const db = initDatabase();
      db.prepare('INSERT INTO history (query, response, tools_used) VALUES (?, ?, ?)').run(
        query,
        response,
        JSON.stringify(['magnitude-vision'])
      );
      
      this.sendResponse(response);
      return response;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Magnitude] Agent error:', errorMsg);
      this.sendResponse(`Error: ${errorMsg}`);
      return `Error: ${errorMsg}`;
    } finally {
      // Clean up
      if (this.agent) {
        try {
          await this.agent.stop();
        } catch {
          // Ignore cleanup errors
        }
        this.agent = null;
      }
      this.isRunning = false;
    }
  }
  
  /**
   * Cancel the current run
   */
  cancel(): void {
    this.shouldCancel = true;
    if (this.agent) {
      this.agent.queueDone().catch(() => {
        // Ignore cancel errors
      });
    }
  }
  
  /**
   * Send status update to UI
   */
  private sendStatus(status: string): void {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('agent:status', status);
    });
  }
  
  /**
   * Send response to UI
   */
  private sendResponse(response: string): void {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('agent:response', response);
    });
  }
}

