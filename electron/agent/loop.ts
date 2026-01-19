import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { BrowserWindow, screen } from 'electron';
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

// Load environment variables for LangSmith tracing
import 'dotenv/config';

interface AgentConfig {
  maxIterations: number;
  maxTokens: number;
}

const DEFAULT_CONFIG: AgentConfig = {
  maxIterations: 10,
  maxTokens: 4096,
};

/**
 * Agent Loop Controller
 * Orchestrates the agent's reasoning and action cycle
 * Now uses LangChain for LangSmith tracing
 */
export class AgentLoop {
  private stateExtractor: StateExtractor;
  private toolExecutor: ToolExecutor;
  private config: AgentConfig;
  private isRunning = false;
  private shouldCancel = false;

  constructor(stateExtractor: StateExtractor, toolExecutor: ToolExecutor) {
    this.stateExtractor = stateExtractor;
    this.toolExecutor = toolExecutor;
    this.config = DEFAULT_CONFIG;

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
        regularTools,
        { width: displayWidth, height: displayHeight },
        this.config.maxTokens
      );

      if (!boundModel) {
        throw new Error(getMissingKeyError(modelName));
      }

      const { model: modelWithTools, invokeOptions: providerInvokeOptions } = boundModel;

      let iterations = 0;
      let finalResponse = '';
      const toolsUsed: string[] = [];
      const actions: Array<{ tool: string; input: unknown; timestamp: number }> = [];
      
      
      while (iterations < this.config.maxIterations && !this.shouldCancel) {
        iterations++;
        
        this.sendStatus('Thinking...');
        console.log(`[Faria] Iteration ${iterations}/${this.config.maxIterations}`);
        
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
            iteration: iterations,
            query: query.slice(0, 100),
          },
        };
        
        const response = await modelWithTools.invoke(messages, invokeOptions);
        
        // Check for cancellation after API call
        if (this.shouldCancel) {
          console.log('[Faria] Cancelled after API call');
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
            } else {
              // Use our tool executor for other tools
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
  
}
