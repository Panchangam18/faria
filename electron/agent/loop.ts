import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { BrowserWindow, screen, shell, ipcMain } from 'electron';
import { StateExtractor, AppState } from '../services/state-extractor';
import { ToolExecutor, ToolDefinition, executeComputerAction, ComputerAction } from './tools';
import { initDatabase } from '../db/sqlite';
import { traceable } from 'langsmith/traceable';
import { getLangchainCallbacks } from 'langsmith/langchain';
import { getAgentSystemPrompt } from '../static/prompts/loader';
import {
  createModelWithTools,
  getSelectedModel,
  getMissingKeyError,
  isComputerUseTool,
  getToolDisplayName,
  getProviderName,
  BoundModel
} from '../services/models';
import { searchMemories, getAllMemories, ContextManager, estimateTokens } from '../services/memory';
import { triggerMemoryAgent } from './memory-agent';
import { ComposioService } from '../services/composio';

// Load environment variables for LangSmith tracing
import 'dotenv/config';

/**
 * Parse Composio tool result to check if authentication is required
 */
interface ComposioAuthRequired {
  toolkit: string;
  redirectUrl: string;
}

function parseComposioAuthRequired(result: string): ComposioAuthRequired | null {
  try {
    const parsed = JSON.parse(result);
    // Check for COMPOSIO_MANAGE_CONNECTIONS response with initiated status
    if (parsed?.data?.results) {
      for (const [toolkit, info] of Object.entries(parsed.data.results)) {
        const toolkitInfo = info as any;
        if (toolkitInfo?.status === 'initiated' && toolkitInfo?.redirect_url) {
          return {
            toolkit: toolkit,
            redirectUrl: toolkitInfo.redirect_url
          };
        }
      }
    }
  } catch {
    // Not JSON or parsing failed
  }
  return null;
}

interface AgentConfig {
  maxTokens: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  maxTokens: 4096,
};

/**
 * Agent Loop Controller
 * Orchestrates the agent's reasoning and action cycle
 * Now uses LangChain for LangSmith tracing
 */
// Tools that don't require approval (informational/read-only or user-initiated)
const SAFE_TOOLS = new Set(['get_state', 'web_search', 'insert_image']);
// Composio tools that don't require approval (management/search tools)
const SAFE_COMPOSIO_TOOLS = new Set(['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_MANAGE_CONNECTIONS']);

/**
 * Format a tool slug into a readable name (e.g., GMAIL_SEND_EMAIL -> Gmail Send Email)
 */
function formatToolSlug(slug: string): string {
  return slug
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Generate a human-readable description for Composio tool approval
 */
function generateComposioApprovalInfo(toolName: string, args: Record<string, unknown>): { displayName: string; details: Record<string, string> } {
  // Handle COMPOSIO_MULTI_EXECUTE_TOOL - extract the actual tool being executed
  if (toolName === 'COMPOSIO_MULTI_EXECUTE_TOOL' && args.tools && Array.isArray(args.tools)) {
    const tools = args.tools as Array<{ tool_slug: string; arguments: Record<string, unknown> }>;
    if (tools.length > 0) {
      const firstTool = tools[0];
      const toolSlug = firstTool.tool_slug || 'Unknown';
      const displayName = formatToolSlug(toolSlug);

      // Extract relevant details from arguments
      const details: Record<string, string> = {};
      const toolArgs = firstTool.arguments || {};

      // Common fields to show
      if (toolArgs.recipient_email) details['To'] = String(toolArgs.recipient_email);
      if (toolArgs.subject) details['Subject'] = String(toolArgs.subject);
      if (toolArgs.body) details['Body'] = String(toolArgs.body);
      if (toolArgs.to) details['To'] = String(toolArgs.to);
      if (toolArgs.message) details['Message'] = String(toolArgs.message);
      if (toolArgs.title) details['Title'] = String(toolArgs.title);
      if (toolArgs.content) details['Content'] = String(toolArgs.content);
      if (toolArgs.repo) details['Repo'] = String(toolArgs.repo);
      if (toolArgs.query) details['Query'] = String(toolArgs.query);

      return { displayName, details };
    }
  }

  // For other Composio tools, extract the app name from the tool name
  // e.g., GMAIL_SEND_EMAIL -> Gmail Send Email
  const displayName = formatToolSlug(toolName.replace(/^COMPOSIO_/, ''));

  // Extract relevant details from args
  const details: Record<string, string> = {};
  if (args.recipient_email) details['To'] = String(args.recipient_email);
  if (args.subject) details['Subject'] = String(args.subject);
  if (args.body) details['Body'] = String(args.body);
  if (args.to) details['To'] = String(args.to);
  if (args.message) details['Message'] = String(args.message);

  return { displayName, details };
}

/**
 * Generate a human-readable description for built-in tool approval
 */
function generateBuiltinApprovalInfo(toolName: string, args: Record<string, unknown>): { displayName: string; details: Record<string, string> } {
  const details: Record<string, string> = {};

  switch (toolName) {
    case 'replace_selected_text':
      if (args.text) details[''] = String(args.text);
      return { displayName: 'Replace Selected Text', details };

    case 'focus_app':
      if (args.name) details['App'] = String(args.name);
      return { displayName: 'Focus App', details };

    case 'run_applescript':
      if (args.script) details['Script'] = String(args.script);
      return { displayName: 'Run AppleScript', details };

    case 'chain_actions':
      if (args.actions && Array.isArray(args.actions)) {
        details['Actions'] = args.actions.map((a: any) => a.type || 'unknown').join(', ');
      }
      return { displayName: 'Chain Actions', details };

    case 'execute_python':
      if (args.code) details['Code'] = String(args.code);
      return { displayName: 'Execute Python', details };

    default:
      return { displayName: formatToolSlug(toolName), details };
  }
}

export class AgentLoop {
  private stateExtractor: StateExtractor;
  private toolExecutor: ToolExecutor;
  private composioService: ComposioService;
  private config: AgentConfig;
  private isRunning = false;
  private shouldCancel = false;
  private pendingAuthResolve: (() => void) | null = null;
  private pendingToolApprovalResolve: ((approved: boolean) => void) | null = null;
  private computerUseApproved = false; // Tracks if computer use has been approved for this invocation

  constructor(stateExtractor: StateExtractor, toolExecutor: ToolExecutor, composioService: ComposioService) {
    this.stateExtractor = stateExtractor;
    this.toolExecutor = toolExecutor;
    this.composioService = composioService;
    this.config = DEFAULT_CONFIG;

    // Listen for auth completion from UI
    ipcMain.on('agent:auth-completed', () => {
      console.log('[Faria] Auth completed, resuming agent');
      if (this.pendingAuthResolve) {
        this.pendingAuthResolve();
        this.pendingAuthResolve = null;
      }
    });

    // Listen for tool approval response from UI
    ipcMain.on('agent:tool-approval-response', (_event, approved: boolean) => {
      console.log(`[Faria] Tool approval response: ${approved ? 'approved' : 'denied'}`);
      if (this.pendingToolApprovalResolve) {
        this.pendingToolApprovalResolve(approved);
        this.pendingToolApprovalResolve = null;
      }
    });

    // Log LangSmith status
    if (process.env.LANGCHAIN_API_KEY && process.env.LANGCHAIN_TRACING_V2 === 'true') {
      console.log('[LangSmith] Tracing enabled for project:', process.env.LANGCHAIN_PROJECT || 'default');
    } else {
      console.log('[LangSmith] Tracing not configured. Set LANGCHAIN_API_KEY and LANGCHAIN_TRACING_V2=true in .env');
    }
  }
  
  /**
   * Run the agent loop for a user query
   * @param query The user's request
   * @param targetApp The app that was focused when the command bar was invoked
   * @param selectedText Optional text that was selected when the command bar was invoked
   */
  async run(query: string, targetApp?: string | null, selectedText?: string | null): Promise<string> {
    if (this.isRunning) {
      throw new Error('Agent is already running');
    }

    this.isRunning = true;
    this.shouldCancel = false;
    this.computerUseApproved = false; // Reset computer use approval for each new invocation

    console.log(`[Faria] Starting agent run with targetApp: ${targetApp}, selectedText: ${selectedText ? `${selectedText.length} chars` : 'none'}`);

    try {
      // Set the target app for tools to use
      this.toolExecutor.setTargetApp(targetApp || null);

      // Run the traceable agent loop - this creates a single parent trace in LangSmith
      // with all iterations nested underneath
      const result = await this.executeAgentLoop(query, targetApp, selectedText);

      this.sendResponse(result);
      return result;
    } finally {
      this.isRunning = false;
    }
  }
  
  /**
   * The core agent loop wrapped with LangSmith traceable
   * This ensures all iterations appear under a single trace
   */
  private executeAgentLoop = traceable(
    async (query: string, targetApp?: string | null, selectedText?: string | null): Promise<string> => {
      // Extract initial state (with selected text if provided)
      this.sendStatus('Extracting state...');
      let state = await this.stateExtractor.extractState(selectedText || undefined);
      this.toolExecutor.setCurrentState(state);

      // Get relevant memories via semantic search
      const relevantMemories = await searchMemories(query, 7);
      const memoryContext = relevantMemories.length > 0
        ? `=== Relevant Memories ===\n${relevantMemories.map(m => `- ${m.content}`).join('\n')}`
        : '';
      
      // Build initial messages for LangChain
      const userPrompt = this.buildUserPrompt(query, state, memoryContext);
      const systemPrompt = getAgentSystemPrompt();
      const messages: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [
        new SystemMessage(systemPrompt),
        typeof userPrompt === 'string'
          ? new HumanMessage(userPrompt)
          : new HumanMessage({ content: userPrompt }),
      ];
      
      // Get tool definitions
      const regularTools = this.toolExecutor.getToolDefinitions().map(this.convertToLangChainTool);

      // Get Composio tools (already in LangChain DynamicStructuredTool format)
      const composioTools = await this.composioService.getTools();
      console.log(`[Faria] Loaded ${composioTools.length} Composio tools`);

      // Create a map of Composio tools by name for quick lookup during execution
      const composioToolMap = new Map<string, any>();
      for (const tool of composioTools) {
        composioToolMap.set(tool.name, tool);
      }

      // Merge all tools - Composio tools are DynamicStructuredTools that handle their own execution
      const allTools = [...regularTools, ...composioTools];

      // Get screen dimensions for computer use tool
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: displayWidth, height: displayHeight } = primaryDisplay.size;
      
      // Get selected model and create model with tools bound
      const modelName = getSelectedModel('selectedModel');
      const providerName = getProviderName(modelName);
      // Set provider for coordinate conversion (Google uses 0-999 normalized, Anthropic uses pixels)
      this.toolExecutor.setProvider(
        providerName === 'anthropic' || providerName === 'google' ? providerName : null
      );

      // Initialize context manager for 50% FIFO context limit
      const contextManager = new ContextManager(modelName);

      // Helper to add message with context tracking and FIFO eviction
      const addMessage = (msg: SystemMessage | HumanMessage | AIMessage | ToolMessage) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const tokens = estimateTokens(content);

        // FIFO: Remove oldest non-system messages if we'd exceed limit
        while (contextManager.getCurrentTokens() + tokens > contextManager.getMaxTokens() && messages.length > 1) {
          const removed = messages.splice(1, 1)[0];
          const removedContent = typeof removed.content === 'string' ? removed.content : JSON.stringify(removed.content);
          // Update context manager by subtracting removed tokens
          (contextManager as any).currentTokens -= estimateTokens(removedContent);
          console.log(`[Context] Removed old message (${estimateTokens(removedContent)} tokens)`);
        }

        messages.push(msg);
        (contextManager as any).currentTokens += tokens;
      };

      const boundModel = createModelWithTools(
        modelName,
        allTools,
        { width: displayWidth, height: displayHeight },
        this.config.maxTokens
      );

      if (!boundModel) {
        throw new Error(getMissingKeyError(modelName));
      }

      const { model: modelWithTools, invokeOptions: providerInvokeOptions } = boundModel;

      let finalResponse = '';
      const toolsUsed: string[] = [];
      const actions: Array<{ tool: string; input: unknown; timestamp: number }> = [];


      while (!this.shouldCancel) {
        
        this.sendStatus('Thinking...');
        
        // Check for cancellation before API call
        if (this.shouldCancel) {
          console.log('[Faria] Cancelled before API call');
          break;
        }
        
        // Get LangChain callbacks that connect to the parent LangSmith trace
        // This ensures model calls appear as children of this agent loop trace
        const callbacks = await getLangchainCallbacks();
        
        // Call LangChain model with callbacks to nest under parent trace
        // Merge provider-specific options with common options
        const invokeOptions: Record<string, unknown> = {
          ...providerInvokeOptions,
          callbacks,
          tags: ['faria', 'agent-loop'],
          metadata: {
            targetApp,
            query: query.slice(0, 100),
          },
        };
        
        // Stream the response for real-time display
        let fullContent = '';
        let toolCalls: any[] = [];

        const stream = await modelWithTools.stream(messages, invokeOptions);

        for await (const chunk of stream) {
          if (this.shouldCancel) break;

          // Handle text content chunks
          if (typeof chunk.content === 'string' && chunk.content) {
            fullContent += chunk.content;
            this.sendChunk(chunk.content);
          } else if (Array.isArray(chunk.content)) {
            for (const part of chunk.content as any[]) {
              if (part.type === 'text' && part.text) {
                fullContent += part.text;
                this.sendChunk(part.text);
              }
            }
          }

          // Accumulate tool calls from chunks
          if (chunk.tool_calls && chunk.tool_calls.length > 0) {
            toolCalls = chunk.tool_calls;
          }
        }

        // Build AIMessage compatible with existing tool handling
        const response = new AIMessage({
          content: fullContent,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          additional_kwargs: {},
        });

        // Check for cancellation after streaming
        if (this.shouldCancel) {
          console.log('[Faria] Cancelled after streaming');
          break;
        }

        console.log(`[Faria] Response received, tool_calls:`, response.tool_calls?.length || 0);

        // Check if there are tool calls
        if (response.tool_calls && response.tool_calls.length > 0) {
          // Add the assistant's response directly - preserves all metadata
          // (id, additional_kwargs, etc.) that LangChain needs for proper
          // message threading with different providers
          addMessage(response);

          // Execute tool calls and add ToolMessage for each
          for (const toolCall of response.tool_calls) {
            // Check for cancellation before each tool call
            if (this.shouldCancel) {
              console.log('[Faria] Cancelled before tool execution');
              break;
            }

            console.log(`[Faria] Tool call: ${toolCall.name}`, JSON.stringify(toolCall.args).slice(0, 500));
            this.sendStatus(`${getToolDisplayName(toolCall.name)}...`);
            toolsUsed.push(toolCall.name);
            actions.push({
              tool: toolCall.name,
              input: toolCall.args,
              timestamp: Date.now()
            });

            // Handle computer tool specially (works for both providers)
            if (isComputerUseTool(toolCall.name)) {
              // Request computer use approval once per invocation
              if (!this.computerUseApproved) {
                this.sendStatus('Waiting for approval...');
                const approved = await this.requestToolApproval(
                  toolCall.name,
                  'Execute computer actions (click, type, screenshot, etc.)',
                  toolCall.args as Record<string, unknown>,
                  false
                );

                if (!approved || this.shouldCancel) {
                  addMessage(new ToolMessage({
                    content: 'Tool execution denied by user',
                    tool_call_id: toolCall.id || toolCall.name,
                    name: toolCall.name,
                  }));
                  continue;
                }
                this.computerUseApproved = true;
              }

              try {
                const computerResult = await executeComputerAction(toolCall.args as ComputerAction);
                console.log(`[Faria] Computer tool result: SUCCESS`);

                addMessage(new ToolMessage({
                  content: computerResult,
                  tool_call_id: toolCall.id || toolCall.name,
                  name: toolCall.name,
                }));
              } catch (error) {
                console.log(`[Faria] Computer tool result: FAILED`, error);
                addMessage(new ToolMessage({
                  content: `Error: ${error}`,
                  tool_call_id: toolCall.id || toolCall.name,
                  name: toolCall.name,
                }));
              }
            } else if (composioToolMap.has(toolCall.name)) {
              // Execute Composio tools through their invoke() method
              const composioTool = composioToolMap.get(toolCall.name);

              // Require approval for Composio tools (except safe ones like search/manage)
              if (!SAFE_COMPOSIO_TOOLS.has(toolCall.name)) {
                const toolDescription = composioTool.description || `Execute ${toolCall.name}`;
                const { displayName, details } = generateComposioApprovalInfo(
                  toolCall.name,
                  toolCall.args as Record<string, unknown>
                );

                this.sendStatus('Waiting for approval...');
                const approved = await this.requestToolApproval(
                  toolCall.name,
                  toolDescription,
                  toolCall.args as Record<string, unknown>,
                  true,
                  displayName,
                  details
                );

                if (!approved || this.shouldCancel) {
                  addMessage(new ToolMessage({
                    content: 'Tool execution denied by user',
                    tool_call_id: toolCall.id || toolCall.name,
                    name: toolCall.name,
                  }));
                  continue;
                }
              }

              try {
                let composioResult = await composioTool.invoke(toolCall.args);
                const resultStr = typeof composioResult === 'string' ? composioResult : JSON.stringify(composioResult);
                console.log(`[Faria] Composio tool result: SUCCESS`, resultStr.slice(0, 200));

                // Check if authentication is required
                const authRequired = parseComposioAuthRequired(resultStr);
                if (authRequired && !this.shouldCancel) {
                  console.log(`[Faria] Auth required for ${authRequired.toolkit}`);

                  // Request auth from user and wait
                  await this.requestAuth(authRequired.toolkit, authRequired.redirectUrl);

                  if (this.shouldCancel) {
                    addMessage(new ToolMessage({
                      content: 'Authentication cancelled',
                      tool_call_id: toolCall.id || toolCall.name,
                      name: toolCall.name,
                    }));
                  } else {
                    // User authenticated - tell the agent to retry
                    addMessage(new ToolMessage({
                      content: `User has authenticated with ${authRequired.toolkit}. Please retry the action.`,
                      tool_call_id: toolCall.id || toolCall.name,
                      name: toolCall.name,
                    }));
                  }
                } else {
                  addMessage(new ToolMessage({
                    content: resultStr,
                    tool_call_id: toolCall.id || toolCall.name,
                    name: toolCall.name,
                  }));
                }
              } catch (error) {
                console.log(`[Faria] Composio tool result: FAILED`, error);
                addMessage(new ToolMessage({
                  content: `Error: ${error}`,
                  tool_call_id: toolCall.id || toolCall.name,
                  name: toolCall.name,
                }));
              }
            } else {
              // Use our tool executor for built-in tools
              // Request approval for computer use tools (not in SAFE_TOOLS)
              // Note: replace_selected_text always requires approval (not covered by computerUseApproved)
              const needsApproval = !SAFE_TOOLS.has(toolCall.name) &&
                (toolCall.name === 'replace_selected_text' || !this.computerUseApproved);

              if (needsApproval) {
                const toolDef = this.toolExecutor.getToolDefinitions().find(t => t.name === toolCall.name);
                const toolDescription = toolDef?.description || `Execute ${toolCall.name}`;
                const { displayName, details } = generateBuiltinApprovalInfo(
                  toolCall.name,
                  toolCall.args as Record<string, unknown>
                );

                this.sendStatus('Waiting for approval...');
                const approved = await this.requestToolApproval(
                  toolCall.name,
                  toolDescription,
                  toolCall.args as Record<string, unknown>,
                  false,
                  displayName,
                  details
                );

                if (!approved || this.shouldCancel) {
                  addMessage(new ToolMessage({
                    content: 'Tool execution denied by user',
                    tool_call_id: toolCall.id || toolCall.name,
                    name: toolCall.name,
                  }));
                  continue;
                }
                // Don't set computerUseApproved for replace_selected_text (always ask)
                if (toolCall.name !== 'replace_selected_text') {
                  this.computerUseApproved = true;
                }
              }

              const result = await this.toolExecutor.execute(
                toolCall.name,
                toolCall.args as Record<string, unknown>
              );

              console.log(`[Faria] Tool result: ${result.success ? 'SUCCESS' : 'FAILED'}`, result.result?.slice(0, 200) || result.error);

              const resultContent = result.success ? (result.result || 'Done') : `Error: ${result.error}`;

              addMessage(new ToolMessage({
                content: resultContent,
                tool_call_id: toolCall.id || toolCall.name,
                name: toolCall.name,
              }));
            }
          }

          // Break out of main loop if cancelled during tool execution
          if (this.shouldCancel) {
            console.log('[Faria] Cancelled after tool execution');
            break;
          }

          // Refresh state for tool executor (but don't add to messages)
          // Standard LangChain pattern: after ToolMessages, invoke model directly
          // Adding HumanMessages between ToolMessages and next model call breaks
          // the expected message flow for some providers
          this.sendStatus('Thinking...');
          state = await this.stateExtractor.extractState();
          this.toolExecutor.setCurrentState(state);
        } else {
          // No tool calls - agent is done
          finalResponse = typeof response.content === 'string' 
            ? response.content 
            : 'Task completed.';
          console.log(`[Faria] Final response: ${finalResponse.slice(0, 200)}...`);
          break;
        }
      }
      
      // If cancelled, return empty string (UI already cleared status)
      if (this.shouldCancel) {
        console.log('[Faria] Run cancelled, returning early');
        return '';
      }

      // Trigger background memory agent to analyze and store memories
      if (finalResponse) {
        triggerMemoryAgent({
          query,
          response: finalResponse,
          memories: getAllMemories(),
          toolsUsed
        });
      }

      // Save to history
      const db = initDatabase();
      db.prepare('INSERT INTO history (query, response, tools_used, agent_type, actions) VALUES (?, ?, ?, ?, ?)').run(
        query, 
        finalResponse,
        toolsUsed.length > 0 ? JSON.stringify(toolsUsed) : null,
        'regular',
        actions.length > 0 ? JSON.stringify(actions) : null
      );
      
      return finalResponse;
    },
    {
      name: 'faria-agent-loop',
      run_type: 'chain',
      tags: ['faria', 'agent'],
    }
  );
  
  /**
   * Cancel the current run
   */
  cancel(): void {
    console.log('[Faria] Cancel requested');
    this.shouldCancel = true;
    // Also resolve any pending auth to unblock
    if (this.pendingAuthResolve) {
      this.pendingAuthResolve();
      this.pendingAuthResolve = null;
    }
    // Also resolve any pending tool approval to unblock
    if (this.pendingToolApprovalResolve) {
      this.pendingToolApprovalResolve(false); // Treat cancel as denial
      this.pendingToolApprovalResolve = null;
    }
  }

  /**
   * Request authentication from the user and wait for completion
   */
  private async requestAuth(toolkit: string, redirectUrl: string): Promise<void> {
    console.log(`[Faria] Requesting auth for ${toolkit}: ${redirectUrl}`);

    // Send auth request to UI
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('agent:auth-required', { toolkit, redirectUrl });
    });

    // Wait for auth completion
    return new Promise((resolve) => {
      this.pendingAuthResolve = resolve;
    });
  }

  /**
   * Request tool approval from the user and wait for response
   * @param toolName Name of the tool
   * @param toolDescription Description of what the tool does
   * @param args The arguments being passed to the tool
   * @param isComposio Whether this is a Composio tool
   * @returns true if approved, false if denied
   */
  private async requestToolApproval(
    toolName: string,
    toolDescription: string,
    args: Record<string, unknown>,
    isComposio: boolean,
    displayName?: string,
    details?: Record<string, string>
  ): Promise<boolean> {
    console.log(`[Faria] Requesting tool approval for ${toolName}`);

    // Send approval request to UI
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('agent:tool-approval-required', {
        toolName,
        toolDescription,
        args,
        isComposio,
        displayName,
        details
      });
    });

    // Wait for approval response
    return new Promise((resolve) => {
      this.pendingToolApprovalResolve = resolve;
    });
  }
  
  /**
   * Build the user prompt with state context
   * Returns multimodal content if screenshot is present
   */
  private buildUserPrompt(query: string, state: AppState, memoryContext: string): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
    const parts: string[] = [];

    if (memoryContext) {
      parts.push(memoryContext);
      parts.push('');
    }

    parts.push(this.stateExtractor.formatForAgent(state));
    parts.push('');
    parts.push('=== User Request ===');
    parts.push(query);

    const textContent = parts.join('\n');

    // If screenshot fallback, include image
    if (state.screenshot) {
      return [
        { type: 'text', text: textContent },
        { type: 'image_url', image_url: { url: state.screenshot } },
      ];
    }

    return textContent;
  }
  
  /**
   * Convert tool definition to LangChain format
   */
  private convertToLangChainTool(tool: ToolDefinition) {
    return {
      name: tool.name,
      description: tool.description,
      schema: tool.parameters,
    };
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

  /**
   * Send streaming chunk to UI
   */
  private sendChunk(chunk: string): void {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.webContents.send('agent:chunk', chunk);
    });
  }

}
