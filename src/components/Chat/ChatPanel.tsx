import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { IoMdSend } from 'react-icons/io';
import { BsStopFill } from 'react-icons/bs';
import { IoChevronDown } from 'react-icons/io5';
import { marked } from 'marked';
import FariaLogo from '../FariaLogo';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
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

function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const streamingRef = useRef('');
  const streamingMessageIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState('');
  const [pendingToolApproval, setPendingToolApproval] = useState<ToolApproval | null>(null);
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
    if (!container || !target || !spacer) return;

    const inner = target.parentElement;
    if (!inner) return;

    // Measure content height excluding the spacer (subtract spacer from total)
    const currentSpacerHeight = parseFloat(spacer.style.height) || 0;
    const contentFromTarget = (inner.scrollHeight - currentSpacerHeight) - target.offsetTop;

    // Spacer should fill the gap so total content from user msg = container height
    const needed = Math.max(0, container.clientHeight - contentFromTarget);
    spacer.style.height = needed + 'px';
  }, []);

  const scrollToLastUserMsg = useCallback(() => {
    updateSpacer();
    const container = messagesContainerRef.current;
    const target = lastUserMsgRef.current;
    if (!container || !target) return;
    container.scrollTop = target.offsetTop - container.offsetTop - 24;
  }, [updateSpacer]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
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
        if (item.response) {
          msgs.push({ id: createMessageId(), role: 'assistant', content: item.response, timestamp: item.created_at + 1 });
        }
      }
      setMessages(msgs);
    };
    load();
  }, []);

  // Keep the latest user message anchored as the assistant response grows.
  useLayoutEffect(() => {
    if (messages.length > 0) {
      scrollToLastUserMsg();
    }
  }, [messages, scrollToLastUserMsg]);

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
      const currentId = streamingMessageIdRef.current;
      if (!currentId) {
        const newId = createMessageId();
        streamingMessageIdRef.current = newId;
        streamingRef.current = chunk;
        setMessages(prev => [...prev, {
          id: newId,
          role: 'assistant',
          content: chunk,
          timestamp: Date.now(),
          isStreaming: true,
        }]);
        return;
      }

      streamingRef.current += chunk;
      setMessages(prev => prev.map((msg) => (
        msg.id === currentId
          ? { ...msg, content: msg.content + chunk }
          : msg
      )));
    });

    const cleanupChunkClear = window.faria.agent.onChunkClear(() => {
      const currentId = streamingMessageIdRef.current;
      if (currentId) {
        setMessages(prev => prev.filter((msg) => msg.id !== currentId));
      }
      streamingMessageIdRef.current = null;
      streamingRef.current = '';
    });

    const cleanupStatus = window.faria.agent.onStatus((newStatus: string) => {
      setStatus(newStatus);
    });

    const cleanupResponse = window.faria.agent.onResponse((newResponse: string) => {
      const currentId = streamingMessageIdRef.current;
      const partial = streamingRef.current;
      const finalContent = newResponse || partial;

      if (currentId) {
        if (finalContent) {
          setMessages(prev => prev.map((msg) => (
            msg.id === currentId
              ? {
                ...msg,
                content: finalContent,
                timestamp: Date.now(),
                isStreaming: false,
              }
              : msg
          )));
        } else {
          setMessages(prev => prev.filter((msg) => msg.id !== currentId));
        }
      } else if (newResponse) {
        setMessages(prev => [...prev, {
          id: createMessageId(),
          role: 'assistant',
          content: newResponse,
          timestamp: Date.now(),
        }]);
      }

      streamingMessageIdRef.current = null;
      streamingRef.current = '';
      setIsProcessing(false);
      setStatus('');
      setPendingToolApproval(null);
      setTimeout(() => textareaRef.current?.focus(), 0);
    });

    const cleanupToolApproval = window.faria.agent.onToolApprovalRequired((data) => {
      setPendingToolApproval(data);
      setStatus('Waiting for approval...');
    });

    return () => {
      cleanupChunk();
      cleanupChunkClear();
      cleanupStatus();
      cleanupResponse();
      cleanupToolApproval();
    };
  }, []);

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
    streamingMessageIdRef.current = null;
    streamingRef.current = '';

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
  }, [input, isProcessing, messages]);

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

  const renderMarkdown = (text: string) => {
    return { __html: marked.parse(text, { async: false, breaks: true, gfm: true }) as string };
  };

  const hasStreamingMessage = messages.some((msg) => msg.isStreaming);

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
          {(() => {
            // Find the index of the last user message
            let lastUserIdx = -1;
            for (let i = messages.length - 1; i >= 0; i--) {
              if (messages[i].role === 'user') { lastUserIdx = i; break; }
            }
            return messages.map((msg, i) => (
              <div
                key={msg.id}
                className={`chat-message chat-message-${msg.role}`}
                ref={i === lastUserIdx ? lastUserMsgRef : undefined}
              >
                <div className="chat-message-bubble">
                  <div
                    className={`chat-message-content markdown-content`}
                    dangerouslySetInnerHTML={renderMarkdown(msg.content)}
                  />
                </div>
              </div>
            ));
          })()}
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
          {isProcessing && status && !hasStreamingMessage && !pendingToolApproval && (
            <div className="chat-status-fire">
              <FariaLogo size={24} className="flame-breathing" />
              <span className="chat-status-text">{status}</span>
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
