import React, { memo, useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { IoMdSend } from 'react-icons/io';
import { BsStopFill } from 'react-icons/bs';
import { IoChevronDown } from 'react-icons/io5';
import { marked } from 'marked';
import FariaLogo from '../FariaLogo';
import { formatAction, getToolIcon } from '../Sidebar/history-utils';

interface ActionData {
  tool: string;
  input: unknown;
  timestamp: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  actions?: ActionData[];
}

interface ToolApproval {
  toolName: string;
  toolDescription: string;
  args: Record<string, unknown>;
  isComposio: boolean;
  displayName?: string;
  details?: Record<string, string>;
}

function formatToolkitName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function createMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const STREAM_FLUSH_INTERVAL_MS = 32;

const MARKDOWN_OPTIONS = { async: false, breaks: true, gfm: true } as const;

const ActionTrace = memo(function ActionTrace({ actions }: { actions: ActionData[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="chat-tool-trace">
      {actions.map((action, idx) => (
        action.tool === '_thinking' ? (
          <div key={idx} className="chat-message-bubble">
            <div
              className="chat-message-content markdown-content"
              dangerouslySetInnerHTML={{
                __html: marked.parse(((action.input as Record<string, unknown>).text as string) || '', MARKDOWN_OPTIONS) as string,
              }}
            />
          </div>
        ) : (
          <div key={idx} className="tool-bubble">
            <span className="tool-bubble-icon">{getToolIcon(action.tool)}</span>
            <span className="tool-bubble-text">{formatAction(action)}</span>
          </div>
        )
      ))}
    </div>
  );
});

const ChatMessageItem = memo(function ChatMessageItem({
  message,
  anchorRef,
}: {
  message: ChatMessage;
  anchorRef?: React.Ref<HTMLDivElement>;
}) {
  const html = useMemo(
    () => ({ __html: marked.parse(message.content, MARKDOWN_OPTIONS) as string }),
    [message.content]
  );
  const hasContent = message.content.trim().length > 0;

  return (
    <div
      className={`chat-message chat-message-${message.role}`}
      ref={anchorRef}
    >
      {message.actions && message.actions.length > 0 && (
        <ActionTrace actions={message.actions} />
      )}
      {hasContent && (
        <div className="chat-message-bubble">
          <div
            className="chat-message-content markdown-content"
            dangerouslySetInnerHTML={html}
          />
        </div>
      )}
    </div>
  );
});

function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const streamingRef = useRef('');
  const streamingMessageIdRef = useRef<string | null>(null);
  const pendingChunkRef = useRef('');
  const chunkFlushTimeoutRef = useRef<number | null>(null);
  const [status, setStatus] = useState('');
  const [pendingToolApproval, setPendingToolApproval] = useState<ToolApproval | null>(null);
  const [pendingActions, setPendingActions] = useState<ActionData[]>([]);
  const pendingActionsRef = useRef<ActionData[]>([]);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastUserMsgRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);

const updateSpacer = useCallback(() => {
    const container = messagesContainerRef.current;
    const target = lastUserMsgRef.current;
    const spacer = bottomSpacerRef.current;
  if (!container || !target || !spacer) return 0;

    const inner = target.parentElement;
  if (!inner) return 0;

    // Measure content height excluding the spacer (subtract spacer from total)
    const currentSpacerHeight = parseFloat(spacer.style.height) || 0;
    const contentFromTarget = (inner.scrollHeight - currentSpacerHeight) - target.offsetTop;

    // Spacer should fill the gap so total content from user msg = container height
    const needed = Math.max(0, container.clientHeight - contentFromTarget);
    spacer.style.height = needed + 'px';
  return needed;
}, []);

  const scrollToLastUserMsg = useCallback(() => {
    updateSpacer();
    const container = messagesContainerRef.current;
    const target = lastUserMsgRef.current;
    if (!container || !target) return;
    container.scrollTop = target.offsetTop - container.offsetTop - 24;
  }, [updateSpacer]);

  const scrollToBottom = useCallback(() => {
  const spacerHeight = updateSpacer();
  if (lastUserMsgRef.current && spacerHeight > 0) {
    scrollToLastUserMsg();
    return;
  }
  messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
}, [scrollToLastUserMsg, updateSpacer]);

  const flushBufferedChunks = useCallback((syncToUi = true) => {
    const pending = pendingChunkRef.current;
    if (!pending) {
      if (chunkFlushTimeoutRef.current !== null) {
        clearTimeout(chunkFlushTimeoutRef.current);
        chunkFlushTimeoutRef.current = null;
      }
      return streamingRef.current;
    }

    if (chunkFlushTimeoutRef.current !== null) {
      clearTimeout(chunkFlushTimeoutRef.current);
      chunkFlushTimeoutRef.current = null;
    }

    pendingChunkRef.current = '';
    streamingRef.current += pending;

    if (syncToUi) {
      const messageId = streamingMessageIdRef.current ?? createMessageId();
      streamingMessageIdRef.current = messageId;
      setStreamingMessage({
        id: messageId,
        role: 'assistant',
        content: streamingRef.current,
        timestamp: Date.now(),
        isStreaming: true,
      });
    }

    return streamingRef.current;
  }, []);

  const clearStreamingState = useCallback(() => {
    if (chunkFlushTimeoutRef.current !== null) {
      clearTimeout(chunkFlushTimeoutRef.current);
      chunkFlushTimeoutRef.current = null;
    }
    pendingChunkRef.current = '';
    streamingMessageIdRef.current = null;
    streamingRef.current = '';
    setStreamingMessage(null);
  }, []);

  // Autofocus input on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Load history on mount
  useEffect(() => {
    const load = async () => {
      const items = await window.faria.history.get();
      // History returns newest-first; reverse for chronological chat order
      items.reverse();
      const msgs: ChatMessage[] = [];
      for (const item of items) {
        msgs.push({ id: createMessageId(), role: 'user', content: item.query, timestamp: item.created_at });
        const actions = item.actions && item.actions.length > 0 ? item.actions : undefined;
        if (item.response || actions) {
          msgs.push({
            id: createMessageId(),
            role: 'assistant',
            content: item.response || '',
            timestamp: item.created_at + 1,
            actions,
          });
        }
      }
      setMessages(msgs);
      setLoaded(true);
    };
    load();
  }, []);

  // Keep the latest user message anchored as the assistant response grows.
  useLayoutEffect(() => {
    if (messages.length > 0 || streamingMessage) {
      scrollToLastUserMsg();
    }
  }, [messages, streamingMessage, scrollToLastUserMsg]);

  // Listen for chat:focus and chat:clear from main process
  useEffect(() => {
    const cleanupFocus = window.faria.chat.onFocus(() => {
      textareaRef.current?.focus();
    });
    const cleanupClear = window.faria.chat.onClear(() => {
      setInput('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
      textareaRef.current?.focus();
    });
    return () => {
      cleanupFocus();
      cleanupClear();
    };
  }, []);

  // Listen for agent events
  useEffect(() => {
    const cleanupChunk = window.faria.agent.onChunk((chunk: string) => {
      pendingChunkRef.current += chunk;
      if (chunkFlushTimeoutRef.current === null) {
        chunkFlushTimeoutRef.current = window.setTimeout(() => {
          flushBufferedChunks(true);
        }, STREAM_FLUSH_INTERVAL_MS);
      }
    });

    const cleanupChunkClear = window.faria.agent.onChunkClear(() => {
      clearStreamingState();
    });

    const cleanupStatus = window.faria.agent.onStatus((newStatus: string) => {
      setStatus(newStatus);
    });

    const cleanupResponse = window.faria.agent.onResponse((newResponse: string) => {
      const currentId = streamingMessageIdRef.current;
      const partial = flushBufferedChunks(false);
      const finalContent = newResponse || partial;
      const actions = pendingActionsRef.current.length > 0 ? [...pendingActionsRef.current] : undefined;

      if (currentId) {
        if (finalContent || actions) {
          setMessages(prev => [...prev, {
            id: currentId,
            role: 'assistant',
            content: finalContent,
            timestamp: Date.now(),
            isStreaming: false,
            actions,
          }]);
        }
      } else if (newResponse || actions) {
        setMessages(prev => [...prev, {
          id: createMessageId(),
          role: 'assistant',
          content: newResponse || '',
          timestamp: Date.now(),
          actions,
        }]);
      }

      clearStreamingState();
      pendingActionsRef.current = [];
      setPendingActions([]);
      setIsProcessing(false);
      setStatus('');
      setPendingToolApproval(null);
      setTimeout(() => textareaRef.current?.focus(), 0);
    });

    const cleanupToolApproval = window.faria.agent.onToolApprovalRequired((data) => {
      setPendingToolApproval(data);
      setStatus('Waiting for approval...');
    });

    const cleanupToolAction = window.faria.agent.onToolAction((action) => {
      if (action.tool === '_thinking') {
        clearStreamingState();
      }
      pendingActionsRef.current = [...pendingActionsRef.current, action];
      setPendingActions(pendingActionsRef.current);
    });

    return () => {
      clearStreamingState();
      cleanupChunk();
      cleanupChunkClear();
      cleanupStatus();
      cleanupResponse();
      cleanupToolApproval();
      cleanupToolAction();
    };
  }, [clearStreamingState, flushBufferedChunks]);

  const handleToolApprove = useCallback(() => {
    setPendingToolApproval(null);
    setStatus('Executing...');
    window.faria.agent.toolApprovalResponse(true);
  }, []);

  const handleToolDeny = useCallback(() => {
    setPendingToolApproval(null);
    window.faria.agent.toolApprovalResponse(false);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isProcessing) return;

    const userMsg: ChatMessage = { id: createMessageId(), role: 'user', content: trimmed, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    textareaRef.current?.focus();
    setIsProcessing(true);
    clearStreamingState();
    pendingActionsRef.current = [];
    setPendingActions([]);

    // Build previousContext from the last exchange
    let previousContext: { query: string; response: string } | undefined;
    const allMsgs = [...messages, userMsg];
    for (let i = allMsgs.length - 1; i >= 0; i--) {
      if (allMsgs[i].role === 'assistant') {
        const assistantContent = allMsgs[i].content;
        for (let j = i - 1; j >= 0; j--) {
          if (allMsgs[j].role === 'user') {
            previousContext = { query: allMsgs[j].content, response: assistantContent };
            break;
          }
        }
        break;
      }
    }

    try {
      setStatus('Extracting state...');
      await window.faria.agent.submit(trimmed, previousContext);
    } catch (error) {
      setMessages(prev => [...prev, {
        id: createMessageId(),
        role: 'assistant',
        content: `Error: ${String(error)}`,
        timestamp: Date.now(),
      }]);
      setIsProcessing(false);
      setStatus('');
    }
  }, [clearStreamingState, input, isProcessing, messages]);

  const handleStop = useCallback(async () => {
    if (!isProcessing) return;
    await window.faria.agent.cancel('chat-stop');
    setIsProcessing(false);
    setStatus('');
    setPendingToolApproval(null);
  }, [isProcessing]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'c' && e.ctrlKey && !e.metaKey && isProcessing) {
      e.preventDefault();
      handleStop();
    }
  };

  // Global keyboard listener for tool approval
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (pendingToolApproval) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleToolApprove();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          handleToolDeny();
        }
      }
    };
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [pendingToolApproval, handleToolApprove, handleToolDeny]);

  // Track scroll position to show/hide scroll-down button
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 100);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
  };

  const hasStreamingMessage = streamingMessage !== null;
  const displayMessages = streamingMessage ? [...messages, streamingMessage] : messages;
  const lastUserIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i;
      }
    }
    return -1;
  }, [messages]);

  if (!loaded) {
    return (
      <div className="chat-panel">
        <div className="loading-state">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages" ref={messagesContainerRef} onScroll={handleScroll}>
        <div className="chat-messages-inner">
          {messages.length === 0 && !isProcessing && (
            <div className="chat-empty">
              <div className="chat-empty-glow" />
              <div className="chat-empty-text">
                <strong>Ask Faria anything</strong>
                <div className="chat-empty-hint">I can help with questions, tasks, and more</div>
              </div>
            </div>
          )}
          <div style={{ flex: '1 0 0' }} />
          {displayMessages.map((msg, i) => (
            <ChatMessageItem
              key={msg.id}
              message={msg}
              anchorRef={i === lastUserIdx ? lastUserMsgRef : undefined}
            />
          ))}
          {isProcessing && pendingActions.length > 0 && !hasStreamingMessage && (
            <ActionTrace actions={pendingActions} />
          )}
          {isProcessing && pendingToolApproval && (
            <div className="chat-tool-approval">
              <div className="chat-tool-approval-header">
                <span className="chat-tool-approval-icon">⚡</span>
                <span className="chat-tool-approval-name">
                  {pendingToolApproval.displayName || (pendingToolApproval.isComposio
                    ? `Use ${formatToolkitName(pendingToolApproval.toolName.split('_')[0])}`
                    : 'Allow computer control?')}
                </span>
              </div>
              {pendingToolApproval.details && Object.keys(pendingToolApproval.details).length > 0 && (
                <div className="chat-tool-approval-details">
                  {Object.entries(pendingToolApproval.details).map(([key, value]) => (
                    <div key={key || 'content'} className="chat-tool-approval-detail">
                      {key ? <><span className="chat-detail-key">{key}:</span> {value}</> : value}
                    </div>
                  ))}
                </div>
              )}
              <div className="chat-tool-approval-actions">
                <button className="chat-tool-btn chat-tool-btn-allow" onClick={handleToolApprove}>
                  <span className="chat-tool-shortcut">↵</span> Allow
                </button>
                <button className="chat-tool-btn chat-tool-btn-deny" onClick={handleToolDeny}>
                  <span className="chat-tool-shortcut">esc</span> Deny
                </button>
              </div>
            </div>
          )}
          {!pendingToolApproval && (
            <div className={`chat-status-fire${isProcessing ? ' active' : ''}`}>
              <FariaLogo size={24} className="flame-breathing" />
              {isProcessing && status && !hasStreamingMessage && <span className="chat-status-text">{status}</span>}
            </div>
          )}
          <div ref={bottomSpacerRef} style={{ flexShrink: 0 }} />
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="chat-input-fade" />
      {showScrollDown && (
        <button className="chat-scroll-down" onClick={() => scrollToBottom()}>
          <IoChevronDown size={18} />
        </button>
      )}
      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            className="chat-input"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Message Faria..."
            rows={1}
            autoFocus
          />
          {isProcessing ? (
            <button className="chat-send-btn" onClick={handleStop} title="Stop">
              <BsStopFill size={18} />
            </button>
          ) : (
            <button
              className="chat-send-btn"
              onClick={handleSubmit}
              disabled={!input.trim()}
              title="Send"
            >
              <IoMdSend size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;
