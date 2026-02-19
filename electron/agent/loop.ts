import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { BrowserWindow, ipcMain, screen } from 'electron';
import { StateExtractor, AppState } from '../services/state-extractor';
import { ToolExecutor } from './tools';
import { initDatabase } from '../db/sqlite';
import { traceable } from 'langsmith/traceable';
import { getLangchainCallbacks } from 'langsmith/langchain';
import { getAgentSystemPrompt } from '../static/prompts/loader';
import {
  createModelWithTools,
  getSelectedModel,
  getMissingKeyError,
  getToolDisplayName,
  getProviderName,
  getToolSettings,
  ToolSettings,
  BoundModel
} from '../services/models';
import { ContextManager, estimateTokens } from '../services/memory';
import { createHFEmbeddingProvider } from '../services/memory/embeddings';
import { getOrCreateMemoryIndexManager } from '../services/memory/memory-index';
import { createMemorySearchTool, createMemoryGetTool } from './tools/memory-tools';
import { appendToDailyLog } from './memory-agent';
import { shouldRunMemoryFlush, runMemoryFlush, recordFlush, resetFlushTracking } from './memory-flush';
import { ComposioService } from '../services/composio';
import { showClickIndicator, hideClickIndicator } from '../services/click-indicator';
import { calculateResizeWidth } from '../services/screenshot';

// Load environment variables for LangSmith tracing
import 'dotenv/config';

/**
 * Cap a single tool result so it doesn't blow the context window.
 * Mirrors openclaw's approach: keep head + tail, discard the middle.
 */
const MAX_TOOL_RESULT_CHARS = 100_000; // ~25K tokens
const TOOL_HEAD_CHARS = 40_000;
const TOOL_TAIL_CHARS = 10_000;

function truncateToolResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_CHARS) return content;
  const head = content.slice(0, TOOL_HEAD_CHARS);
  const tail = content.slice(-TOOL_TAIL_CHARS);
  return `${head}\n\n... [tool result trimmed: kept first ${TOOL_HEAD_CHARS} and last ${TOOL_TAIL_CHARS} of ${content.length} chars] ...\n\n${tail}`;
}

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
const SAFE_TOOLS = new Set(['get_state', 'web_search', 'insert_image', 'memory_search', 'memory_get', 'read_file']);
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

    case 'computer_actions': {
      if (args.actions && Array.isArray(args.actions)) {
        const actionTypes = args.actions.map((a: any) => a.type || 'unknown');
        const hasClick = actionTypes.some((t: string) =>
          ['click', 'right_click', 'double_click'].includes(t)
        );
        if (hasClick) {
          // Click actions use the visual indicator overlay, no detail text needed
          return { displayName: 'Faria wants to click', details: {} };
        }
        details['Actions'] = actionTypes.join(', ');
      }
      return { displayName: 'Allow computer control?', details };
    }

    case 'execute_python':
      if (args.code) details['Code'] = String(args.code);
      return { displayName: 'Execute Python', details };

    case 'execute_bash':
      if (args.command) details['Command'] = String(args.command);
      return { displayName: 'Execute Bash', details };

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
  private conversationHistory: (SystemMessage | HumanMessage | AIMessage | ToolMessage)[] = [];

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
      // Determine provider early — needed for screenshot sizing decisions
      const modelName = getSelectedModel('selectedModel');
      const providerName = getProviderName(modelName);
      const provider: 'anthropic' | 'google' | null =
        providerName === 'anthropic' || providerName === 'google' ? providerName : null;

      // Set provider on state extractor (controls screenshot resolution)
      // and tool executor (controls coordinate conversion)
      this.stateExtractor.setProvider(provider);
      this.toolExecutor.setProvider(provider);

      // Extract initial state (with selected text if provided)
      this.sendStatus('Extracting state...');
      let state = await this.stateExtractor.extractState(selectedText || undefined);
      this.toolExecutor.setCurrentState(state);

      // Build user message and append to conversation history
      const userPrompt = this.buildUserPrompt(query, state);
      const systemPrompt = getAgentSystemPrompt();
      const userMessage = typeof userPrompt === 'string'
        ? new HumanMessage(userPrompt)
        : new HumanMessage({ content: userPrompt });

      if (this.conversationHistory.length === 0) {
        // First turn: initialize with system prompt + user message
        this.conversationHistory = [new SystemMessage(systemPrompt), userMessage];
      } else {
        // Follow-up turn: update system prompt, append new user message
        this.conversationHistory[0] = new SystemMessage(systemPrompt);
        this.conversationHistory.push(userMessage);
      }

      const messages = this.conversationHistory;

      // Check tool settings
      const toolSettings = getToolSettings();
      console.log(`[Faria] Tool settings:`, toolSettings);

      // Get built-in tools (now DynamicStructuredTool instances like Composio)
      const memoryDb = initDatabase();
      const embeddingProvider = createHFEmbeddingProvider();
      const memoryManager = getOrCreateMemoryIndexManager(memoryDb, embeddingProvider);
      const memoryTools = [createMemorySearchTool(memoryManager), createMemoryGetTool(memoryManager)];
      const builtinTools = [...this.toolExecutor.getTools(toolSettings), ...memoryTools];
      console.log(`[Faria] Loaded ${builtinTools.length} built-in tools (incl. memory)`);

      // Get Composio tools (already in LangChain DynamicStructuredTool format)
      let composioTools: Awaited<ReturnType<typeof this.composioService.getTools>> = [];
      if (toolSettings.integrations !== 'disabled') {
        composioTools = await this.composioService.getTools();
        console.log(`[Faria] Loaded ${composioTools.length} Composio tools`);
      } else {
        console.log(`[Faria] Integrations disabled, skipping Composio tools`);
      }

      // Merge all tools - both built-in and Composio are now DynamicStructuredTools
      const allTools = [...builtinTools, ...composioTools];

      // Initialize context manager for 50% FIFO context limit
      const contextManager = new ContextManager(modelName);
      resetFlushTracking();
      let flushRunning = false;

      const estimateTokensForContext = (msg: SystemMessage | HumanMessage | AIMessage | ToolMessage): number => {
        if (typeof msg.content === 'string') {
          return estimateTokens(msg.content);
        }
        if (Array.isArray(msg.content)) {
          const normalized = msg.content.map((part: any) => {
            if (part?.type === 'text' && part.text) return part.text;
            if (part?.type === 'image_url') return '[image_url]';
            if (part?.type === 'image') return '[image]';
            return JSON.stringify(part);
          }).join('\n');
          return estimateTokens(normalized);
        }
        return estimateTokens(JSON.stringify(msg.content));
      };

      const removeOldestMessage = (
        stack: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage>,
        manager: ContextManager
      ): { tokens: number; role: string } => {
        const removed = stack.splice(1, 1)[0];
        let removedTokens = estimateTokensForContext(removed);
        (manager as any).currentTokens -= removedTokens;

        // If we removed an AIMessage with tool calls, also remove its ToolMessage results
        if (removed instanceof AIMessage && removed.tool_calls?.length) {
          const ids = new Set(
            removed.tool_calls
              .map(call => call.id)
              .filter((id): id is string => typeof id === 'string')
          );

          while (stack.length > 1) {
            const next = stack[1];
            if (next instanceof ToolMessage && ids.has(next.tool_call_id)) {
              const toolTokens = estimateTokensForContext(next);
              stack.splice(1, 1);
              (manager as any).currentTokens -= toolTokens;
              removedTokens += toolTokens;
            } else {
              break;
            }
          }
        }

        // Cascade-remove orphaned messages at position 1.
        // Removing one orphan can expose another (e.g. ToolMessage → AIMessage(tool_calls) → ToolMessage),
        // so loop until position 1 is clean.
        let changed = true;
        while (changed && stack.length > 1) {
          changed = false;

          // Orphaned ToolMessages (their AIMessage was already evicted)
          while (stack.length > 1 && stack[1] instanceof ToolMessage) {
            const orphan = stack.splice(1, 1)[0];
            const orphanTokens = estimateTokensForContext(orphan);
            (manager as any).currentTokens -= orphanTokens;
            removedTokens += orphanTokens;
            console.log(`[Context] Removed orphaned tool result (${orphanTokens} tokens)`);
            changed = true;
          }

          // Orphaned AIMessage with tool_calls (no preceding user message)
          if (stack.length > 1 && stack[1] instanceof AIMessage && (stack[1] as AIMessage).tool_calls?.length) {
            const ai = stack.splice(1, 1)[0] as AIMessage;
            const aiTokens = estimateTokensForContext(ai);
            (manager as any).currentTokens -= aiTokens;
            removedTokens += aiTokens;
            console.log(`[Context] Removed orphaned AI tool_call (${aiTokens} tokens)`);
            changed = true;

            const ids = new Set(
              ai.tool_calls!
                .map(call => call.id)
                .filter((id): id is string => typeof id === 'string')
            );
            while (stack.length > 1 && stack[1] instanceof ToolMessage) {
              const toolMsg = stack[1] as ToolMessage;
              if (ids.has(toolMsg.tool_call_id)) {
                const toolTokens = estimateTokensForContext(toolMsg);
                stack.splice(1, 1);
                (manager as any).currentTokens -= toolTokens;
                removedTokens += toolTokens;
              } else {
                break;
              }
            }
          }
        }

        return { tokens: removedTokens, role: removed.getType() };
      };

      const repairToolMessageOrdering = (
        stack: Array<SystemMessage | HumanMessage | AIMessage | ToolMessage>,
        manager: ContextManager
      ): void => {
        let activeToolCallIds: Set<string> | null = null;
        let i = 1;
        while (i < stack.length) {
          const prev = stack[i - 1];
          const msg = stack[i];

          if (msg instanceof AIMessage && msg.tool_calls?.length) {
            const prevIsValid = prev instanceof HumanMessage || prev instanceof ToolMessage;
            if (!prevIsValid) {
              const ai = stack.splice(i, 1)[0] as AIMessage;
              const aiTokens = estimateTokensForContext(ai);
              (manager as any).currentTokens -= aiTokens;
              console.log(`[Context] Removed orphaned AI tool_call (${aiTokens} tokens)`);

              const ids = new Set(
                (ai.tool_calls ?? [])
                  .map(call => call.id)
                  .filter((id): id is string => typeof id === 'string')
              );
              while (i < stack.length && stack[i] instanceof ToolMessage) {
                const toolMsg = stack[i] as ToolMessage;
                if (ids.has(toolMsg.tool_call_id)) {
                  const toolTokens = estimateTokensForContext(toolMsg);
                  stack.splice(i, 1);
                  (manager as any).currentTokens -= toolTokens;
                } else {
                  break;
                }
              }
              activeToolCallIds = null;
              continue;
            }

            activeToolCallIds = new Set(
              msg.tool_calls
                .map(call => call.id)
                .filter((id): id is string => typeof id === 'string')
            );
            i++;
            continue;
          }

          if (msg instanceof ToolMessage) {
            const isValid = activeToolCallIds?.has(msg.tool_call_id) ?? false;
            if (!isValid) {
              const orphan = stack.splice(i, 1)[0];
              const orphanTokens = estimateTokensForContext(orphan);
              (manager as any).currentTokens -= orphanTokens;
              console.log(`[Context] Removed orphaned tool result (${orphanTokens} tokens)`);
              continue;
            }
            i++;
            continue;
          }

          activeToolCallIds = null;
          i++;
        }
      };

      // Truncate oversized tool results in restored history before token accounting
      for (const msg of messages) {
        if (msg instanceof ToolMessage && typeof msg.content === 'string') {
          msg.content = truncateToolResult(msg.content);
        }
      }

      // Seed context manager with token count from existing conversation history
      for (const msg of messages) {
        (contextManager as any).currentTokens += estimateTokensForContext(msg);
      }

      // FIFO-trim restored history if it exceeds the current model's context limit.
      // Uses removeOldestMessage to keep tool_call/tool_result pairs together.
      while (contextManager.getCurrentTokens() > contextManager.getMaxTokens() && messages.length > 1) {
        const removed = removeOldestMessage(messages, contextManager);
        console.log(`[Context] Trimmed restored message (${removed.tokens} tokens, role: ${removed.role})`);
        repairToolMessageOrdering(messages, contextManager);
      }

      repairToolMessageOrdering(messages, contextManager);

      if (messages.length > 1) {
        console.log(`[Faria] Restored ${messages.length - 1} messages from conversation history (${contextManager.getCurrentTokens()} tokens)`);
      }

      // Helper to add message with context tracking and FIFO eviction
      const addMessage = (msg: SystemMessage | HumanMessage | AIMessage | ToolMessage) => {
        if (msg instanceof ToolMessage && typeof msg.content === 'string') {
          msg.content = truncateToolResult(msg.content);
        }
        const tokens = estimateTokensForContext(msg);

        // Pre-eviction memory flush: save durable facts before context is lost
        if (!flushRunning && shouldRunMemoryFlush(contextManager)) {
          flushRunning = true;
          const summary = messages
            .filter((m) => !(m instanceof SystemMessage))
            .map((m) => {
              const role = m.getType();
              const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
              return `${role}: ${text.slice(0, 500)}`;
            })
            .join('\n');
          runMemoryFlush(summary)
            .then(() => {
              recordFlush(contextManager.getCurrentTokens());
            })
            .catch((err) => console.error('[MemoryFlush] Background flush error:', err))
            .finally(() => {
              flushRunning = false;
            });
        }

        // FIFO: Remove oldest non-system messages if we'd exceed limit
        while (contextManager.getCurrentTokens() + tokens > contextManager.getMaxTokens() && messages.length > 1) {
          const removed = removeOldestMessage(messages, contextManager);
          console.log(`[Context] Removed old message (${removed.tokens} tokens, role: ${removed.role})`);
          repairToolMessageOrdering(messages, contextManager);
        }

        messages.push(msg);
        (contextManager as any).currentTokens += tokens;
      };

      const boundModel = createModelWithTools(
        modelName,
        allTools,
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
        // Use LangChain's native AIMessageChunk merging to handle tool_call_chunks
        let aggregatedChunk: any = null;

        const stream = await modelWithTools.stream(messages, invokeOptions);

        for await (const chunk of stream) {
          if (this.shouldCancel) break;

          // LangChain native way: merge chunks using concat()
          // This automatically handles tool_call_chunks merging
          aggregatedChunk = aggregatedChunk ? aggregatedChunk.concat(chunk) : chunk;

          // Handle text content chunks for streaming display
          if (typeof chunk.content === 'string' && chunk.content) {
            this.sendChunk(chunk.content);
          } else if (Array.isArray(chunk.content)) {
            for (const part of chunk.content as any[]) {
              if (part.type === 'text' && part.text) {
                this.sendChunk(part.text);
              }
            }
          }
        }

        // Build AIMessage from the fully merged chunk
        // LangChain's concat() has already merged tool_call_chunks into tool_calls
        // Handle both string content and array content (Anthropic uses array of content blocks)
        let responseContent: string;
        if (typeof aggregatedChunk.content === 'string') {
          responseContent = aggregatedChunk.content;
        } else if (Array.isArray(aggregatedChunk.content)) {
          responseContent = aggregatedChunk.content
            .filter((part: any) => part.type === 'text' && part.text)
            .map((part: any) => part.text)
            .join('');
        } else {
          responseContent = '';
        }

        const response = new AIMessage({
          content: responseContent,
          tool_calls: aggregatedChunk.tool_calls || [],
          additional_kwargs: aggregatedChunk.additional_kwargs || {},
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

            // UNIFIED execution for ALL tools (built-in + Composio)
            const toolToExecute = allTools.find(t => t.name === toolCall.name);

            if (!toolToExecute) {
              addMessage(new ToolMessage({
                content: `Unknown tool: ${toolCall.name}`,
                tool_call_id: toolCall.id || toolCall.name,
                name: toolCall.name,
              }));
              continue;
            }

            // Check if this is a Composio tool
            const isComposioTool = !SAFE_TOOLS.has(toolCall.name) &&
                                    !['get_state', 'computer_actions', 'web_search',
                                      'insert_image', 'replace_selected_text', 'execute_python', 'execute_bash'].includes(toolCall.name);

            // Determine if approval is needed based on tool settings
            const needsApproval = this.checkIfApprovalNeeded(
              toolCall.name,
              toolCall.args as Record<string, unknown>,
              isComposioTool,
              toolSettings
            );

            if (needsApproval) {
              const toolDescription = toolToExecute.description || `Execute ${toolCall.name}`;
              const { displayName, details } = isComposioTool
                ? generateComposioApprovalInfo(toolCall.name, toolCall.args as Record<string, unknown>)
                : generateBuiltinApprovalInfo(toolCall.name, toolCall.args as Record<string, unknown>);

              // Show pulsing click indicator overlay for click actions
              if (toolCall.name === 'computer_actions') {
                const clickCoords = this.extractClickCoordinates(
                  toolCall.args as Record<string, unknown>,
                  providerName
                );
                if (clickCoords) {
                  showClickIndicator(clickCoords.x, clickCoords.y);
                }
              }

              this.sendStatus('Waiting for approval...');
              const approved = await this.requestToolApproval(
                toolCall.name,
                toolDescription,
                toolCall.args as Record<string, unknown>,
                isComposioTool,
                displayName,
                details
              );

              // Hide click indicator once user responds
              hideClickIndicator();

              if (!approved || this.shouldCancel) {
                addMessage(new ToolMessage({
                  content: 'Tool execution denied by user',
                  tool_call_id: toolCall.id || toolCall.name,
                  name: toolCall.name,
                }));
                continue;
              }

              // Don't set computerUseApproved for replace_selected_text (always ask)
              if (!isComposioTool && toolCall.name !== 'replace_selected_text') {
                this.computerUseApproved = true;
              }
            }

            // Execute the tool via its invoke() method
            try {
              const result = await toolToExecute.invoke(toolCall.args);
              const resultContent = Array.isArray(result)
                ? result
                : typeof result === 'string'
                  ? result
                  : JSON.stringify(result);
              const logPreview = Array.isArray(result)
                ? '[array result]'
                : resultContent;
              console.log(`[Faria] Tool result: SUCCESS`, String(logPreview).slice(0, 200));

              // Check for Composio auth requirement
              if (typeof resultContent === 'string') {
                const authRequired = parseComposioAuthRequired(resultContent);
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
                  continue;
                }
              }

              addMessage(new ToolMessage({
                content: resultContent,
                tool_call_id: toolCall.id || toolCall.name,
                name: toolCall.name,
              }));
            } catch (error) {
              console.log(`[Faria] Tool result: FAILED`, error);
              addMessage(new ToolMessage({
                content: `Error: ${error}`,
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
          if (providerName === 'google') {
            const pendingImages = this.toolExecutor.consumePendingImages();
            if (pendingImages.length > 0) {
              addMessage(new HumanMessage({
                content: [
                  { type: 'text', text: 'Screenshot from tool execution.' },
                  ...pendingImages.map((data) => ({
                    type: 'image_url',
                    image_url: { url: `data:image/png;base64,${data}` },
                  })),
                ],
              }));
            }
          }
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

      // Append interaction summary to daily memory log (non-blocking)
      if (finalResponse) {
        appendToDailyLog(query, finalResponse, toolsUsed);
      }

      // Save to history
      const db = initDatabase();
      db.prepare('INSERT INTO history (query, response, tools_used, agent_type, actions, context_text) VALUES (?, ?, ?, ?, ?, ?)').run(
        query,
        finalResponse,
        toolsUsed.length > 0 ? JSON.stringify(toolsUsed) : null,
        'regular',
        actions.length > 0 ? JSON.stringify(actions) : null,
        selectedText || null
      );
      
      return finalResponse;
    },
    {
      name: 'faria-agent',
      run_type: 'chain',
      tags: ['faria', 'agent'],
    }
  );
  
  /**
   * Cancel the current run
   */
  clearHistory(): void {
    this.conversationHistory = [];
    console.log('[Faria] Conversation history cleared');
  }

  cancel(): void {
    console.log('[Faria] Cancel requested');
    this.shouldCancel = true;
    hideClickIndicator();
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
   * Extract the first click coordinate from computer_actions tool args.
   * Converts Google normalized (0-1000) coordinates to logical screen points.
   * Returns null if no click action or no coordinates found.
   */
  private extractClickCoordinates(
    args: Record<string, unknown>,
    providerName: string
  ): { x: number; y: number } | null {
    if (!args.actions || !Array.isArray(args.actions)) return null;

    const clickAction = (args.actions as Array<any>).find((a: any) =>
      ['click', 'right_click', 'double_click'].includes(a.type)
    );
    if (!clickAction) return null;

    let x: number | undefined;
    let y: number | undefined;

    if (clickAction.coordinate && Array.isArray(clickAction.coordinate)) {
      [x, y] = clickAction.coordinate;
    } else if (clickAction.x !== undefined && clickAction.y !== undefined) {
      x = clickAction.x;
      y = clickAction.y;
    }

    if (x === undefined || y === undefined) return null;

    // Convert provider coordinates to logical screen points
    if (providerName === 'google' && x <= 1000 && y <= 1000) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.size;
      x = Math.round((x / 1000) * screenWidth);
      y = Math.round((y / 1000) * screenHeight);
    } else if (providerName === 'anthropic') {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.size;
      const scaleFactor = primaryDisplay.scaleFactor || 1;
      const nativeWidth = screenWidth * scaleFactor;
      const nativeHeight = screenHeight * scaleFactor;
      const ssWidth = calculateResizeWidth(nativeWidth, nativeHeight);
      const ssHeight = Math.round(nativeHeight * (ssWidth / nativeWidth));
      x = Math.round((x / ssWidth) * screenWidth);
      y = Math.round((y / ssHeight) * screenHeight);
    }

    return { x, y };
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
   * Check if approval is needed for a tool based on settings
   * @param toolName Name of the tool
   * @param args The arguments being passed to the tool
   * @param isComposio Whether this is a Composio tool
   * @param toolSettings Current tool settings
   * @returns true if approval is needed, false if auto-approved or safe
   */
  private checkIfApprovalNeeded(
    toolName: string,
    args: Record<string, unknown>,
    isComposio: boolean,
    toolSettings: ToolSettings
  ): boolean {
    // Safe tools never need approval
    if (SAFE_TOOLS.has(toolName)) {
      return false;
    }

    // For Composio tools, check integrations setting
    if (isComposio) {
      // Safe Composio tools (search/manage) don't need approval
      if (SAFE_COMPOSIO_TOOLS.has(toolName)) {
        return false;
      }
      // If integrations is auto-approve, no approval needed
      if (toolSettings.integrations === 'auto-approve') {
        return false;
      }
      // Otherwise needs approval
      return true;
    }

    // For computer_actions, check what actions are being performed
    if (toolName === 'computer_actions' && args.actions && Array.isArray(args.actions)) {
      const actions = args.actions as Array<{ type: string }>;

      for (const action of actions) {
        const actionType = action.type;

        // Check each action type against its setting
        if (['click', 'right_click', 'double_click', 'mouse_move'].includes(actionType)) {
          if (toolSettings.clicking === 'enabled') {
            // Needs approval unless already approved this session
            if (!this.computerUseApproved) return true;
          } else if (toolSettings.clicking === 'auto-approve') {
            // No approval needed
            continue;
          }
        }

        if (['scroll', 'drag'].includes(actionType)) {
          if (toolSettings.scrolling === 'enabled') {
            if (!this.computerUseApproved) return true;
          } else if (toolSettings.scrolling === 'auto-approve') {
            continue;
          }
        }

        if (['type', 'key'].includes(actionType)) {
          if (toolSettings.typing === 'enabled') {
            if (!this.computerUseApproved) return true;
          } else if (toolSettings.typing === 'auto-approve') {
            continue;
          }
        }

        if (actionType === 'screenshot') {
          if (toolSettings.screenshot === 'enabled') {
            if (!this.computerUseApproved) return true;
          } else if (toolSettings.screenshot === 'auto-approve') {
            continue;
          }
        }

        if (actionType === 'insert_image') {
          if (toolSettings.insertImage === 'enabled') {
            if (!this.computerUseApproved) return true;
          } else if (toolSettings.insertImage === 'auto-approve') {
            continue;
          }
        }
      }

      return false;
    }

    // replace_selected_text - check replaceText setting
    if (toolName === 'replace_selected_text') {
      if (toolSettings.replaceText === 'auto-approve') {
        return false;
      }
      if (toolSettings.replaceText === 'disabled') {
        return false; // Will be blocked elsewhere
      }
      return true; // 'enabled' requires approval
    }

    // Code editing tools - check codeEditing setting
    if (toolName === 'write_file' || toolName === 'edit_file') {
      if (toolSettings.codeEditing === 'auto-approve') {
        return false;
      }
      if (toolSettings.codeEditing === 'disabled') {
        return false;
      }
      return true; // 'enabled' requires approval
    }

    // Default: needs approval if not already approved this session
    return !this.computerUseApproved;
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
  private buildUserPrompt(query: string, state: AppState): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
    const parts: string[] = [];

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
