import React, { useState, useEffect } from 'react';
import { MdDescription, MdChevronRight, MdExpandMore } from 'react-icons/md';
import { marked } from 'marked';

interface ActionData {
  tool: string;
  input: unknown;
  timestamp: number;
}

interface HistoryItem {
  id: number;
  query: string;
  response: string;
  created_at: number;
  tools_used?: string[] | null;
  agent_type?: string;
  actions?: ActionData[] | null;
  context_text?: string | null;
}

interface GroupedHistory {
  [date: string]: HistoryItem[];
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string | undefined | null, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Format an action into human-readable text
 */
function formatAction(action: ActionData): string {
  const input = action.input as Record<string, unknown>;

  switch (action.tool) {
    case 'web_search':
      return `Searched web for "${truncate(input.query as string, 50)}"`;

    case 'make_edit':
    case 'suggest_edits': {
      const edits = input.edits as Array<{ oldText?: string; newText?: string }>;
      if (edits && edits.length > 0) {
        const edit = edits[0];
        const newText = truncate(edit.newText, 60);
        return `Made edit: "${newText}"`;
      }
      return 'Made edit';
    }

    case 'insert_image':
      return `Inserted image: "${truncate(input.query as string, 50)}"`;

    case 'answer':
      return `Answered: "${truncate(input.text as string, 80)}"`;

    case 'replace_selected_text':
      return `Replaced text with: "${truncate(input.text as string, 60)}"`;

    case 'execute_python': {
      const code = input.code as string;
      if (code) {
        // Show first line or truncated code
        const firstLine = code.split('\n')[0];
        return `Executed Python: ${truncate(firstLine, 50)}`;
      }
      return 'Executed Python code';
    }

    case 'computer_actions': {
      const actions = input.actions as Array<{
        type: string;
        text?: string;
        key?: string;
        app?: string;
        script?: string;
        query?: string;
        x?: number;
        y?: number;
        coordinate?: number[];
      }>;
      if (actions && actions.length > 0) {
        const summaries = actions.map(a => {
          switch (a.type) {
            case 'type':
              return `typed "${truncate(a.text, 30)}"`;
            case 'key':
              return `pressed ${a.key}`;
            case 'hotkey':
              return 'pressed hotkey';
            case 'activate':
              return `activated ${a.app}`;
            case 'click':
              if (a.coordinate) return `clicked at (${a.coordinate[0]}, ${a.coordinate[1]})`;
              if (a.x !== undefined && a.y !== undefined) return `clicked at (${a.x}, ${a.y})`;
              return 'clicked';
            case 'right_click':
              return 'right-clicked';
            case 'double_click':
              return 'double-clicked';
            case 'scroll':
              return 'scrolled';
            case 'drag':
              return 'dragged';
            case 'wait':
              return 'waited';
            case 'screenshot':
              return 'took screenshot';
            case 'insert_image':
              return `inserted image "${truncate(a.query, 30)}"`;
            case 'applescript':
              return 'ran AppleScript';
            case 'mouse_move':
              return 'moved mouse';
            default:
              return a.type;
          }
        });
        return summaries.join(' → ');
      }
      return 'Performed actions';
    }

    case 'get_state':
      return 'Retrieved app state';

    case 'computer':
      return `Computer: ${input.action}`;

    // Composio tools
    case 'COMPOSIO_SEARCH_TOOLS': {
      const queries = input.queries as Array<{ use_case?: string }>;
      if (queries && queries.length > 0 && queries[0].use_case) {
        return `Search tools: "${truncate(queries[0].use_case, 50)}"`;
      }
      return 'Search tools';
    }

    case 'COMPOSIO_MULTI_EXECUTE_TOOL': {
      const tools = input.tools as Array<{ tool_slug?: string; arguments?: Record<string, unknown> }>;
      if (tools && tools.length > 0) {
        const firstTool = tools[0];
        const toolSlug = firstTool.tool_slug || '';
        const toolArgs = firstTool.arguments || {};

        // Format tool slug: GOOGLECALENDAR_EVENTS_LIST -> Google Calendar Events List
        const displayName = toolSlug
          .split('_')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');

        // Extract key details from arguments
        const detailParts: string[] = [];
        if (toolArgs.recipient_email) detailParts.push(`to: ${toolArgs.recipient_email}`);
        if (toolArgs.subject) detailParts.push(`"${truncate(String(toolArgs.subject), 30)}"`);
        if (toolArgs.to) detailParts.push(`to: ${toolArgs.to}`);
        if (toolArgs.message) detailParts.push(`"${truncate(String(toolArgs.message), 30)}"`);
        if (toolArgs.title) detailParts.push(`"${truncate(String(toolArgs.title), 30)}"`);
        if (toolArgs.query) detailParts.push(`"${truncate(String(toolArgs.query), 30)}"`);
        if (toolArgs.calendarId) detailParts.push(`calendar: ${toolArgs.calendarId}`);
        if (toolArgs.timezone) detailParts.push(`tz: ${toolArgs.timezone}`);

        if (detailParts.length > 0) {
          return `${displayName} (${detailParts.slice(0, 2).join(', ')})`;
        }
        return displayName;
      }
      return 'Execute integration';
    }

    default: {
      // For unknown tools (including Composio tools), format nicely
      // Convert SCREAMING_SNAKE_CASE or snake_case to Title Case
      const toolName = action.tool
        .replace(/^COMPOSIO_/i, '') // Remove COMPOSIO_ prefix
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase()); // Title case

      // Try to extract meaningful info from input
      const inputKeys = Object.keys(input);
      if (inputKeys.length > 0) {
        // Look for common meaningful fields
        const meaningfulFields = ['query', 'text', 'message', 'content', 'name', 'title', 'url', 'path', 'body', 'subject'];
        for (const field of meaningfulFields) {
          if (input[field] && typeof input[field] === 'string') {
            return `${toolName}: "${truncate(input[field] as string, 50)}"`;
          }
        }
        // If no meaningful field found, just show the tool name with first key
        const firstKey = inputKeys[0];
        const firstValue = input[firstKey];
        if (typeof firstValue === 'string' && firstValue.length > 0) {
          return `${toolName}: ${truncate(firstValue, 40)}`;
        }
      }
      return toolName;
    }
  }
}

/**
 * Parse query string to extract the actual query (removing context text format)
 */
function parseQuery(queryString: string): string {
  // Match pattern: "query" "context" - return just the query
  const match = queryString.match(/^"([^"]+)"(?:\s+"[^"]*")?$/);
  if (match) {
    return match[1];
  }
  return queryString;
}

function HistoryPanel() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    loadHistory();
    // Re-fetch history when the agent completes a response (history is saved before this event fires)
    const cleanup = window.faria.agent.onResponse(() => {
      loadHistory();
    });
    return cleanup;
  }, []);

  const loadHistory = async () => {
    setLoading(true);
    const items = await window.faria.history.get();
    setHistory(items);
    setLoading(false);
  };

  const groupByDate = (items: HistoryItem[]): GroupedHistory => {
    const groups: GroupedHistory = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();

    items.forEach((item) => {
      const itemDate = new Date(item.created_at).toDateString();
      let groupName: string;

      if (itemDate === today) {
        groupName = 'Today';
      } else if (itemDate === yesterday) {
        groupName = 'Yesterday';
      } else {
        groupName = new Date(item.created_at).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
        });
      }

      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(item);
    });

    return groups;
  };

  const grouped = groupByDate(history);

  if (loading) {
    return (
      <div className="history-panel">
        <div className="empty-state">
          <div className="loading-spinner" style={{
            width: '24px',
            height: '24px',
            border: '3px solid var(--color-border)',
            borderTopColor: 'var(--color-accent)',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
            marginBottom: 'var(--spacing-md)'
          }} />
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="history-panel">
        <div className="empty-state">
          <div className="empty-state-icon">
            <MdDescription size={48} />
          </div>
          <p>No queries yet</p>
          <p style={{ fontSize: 'var(--font-size-sm)', marginTop: 'var(--spacing-sm)' }}>
            Press <kbd style={{ 
              background: 'var(--color-surface)', 
              padding: '2px 6px', 
              borderRadius: '4px',
              border: '1px solid var(--color-border)'
          }}>⌘ ⏎</kbd> to open Faria
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="history-panel">
      {Object.entries(grouped).map(([date, items]) => (
        <div key={date} className="date-group">
          <div className="date-group-title">{date}</div>
            {items.map((item, index) => {
              const isLastItem = index === items.length - 1;
              const userQuery = parseQuery(item.query);
              const contextText = item.context_text;
              
              const isExpanded = expandedId === item.id;
              const isHovered = hoveredId === item.id;

              return (
                <div
                  key={item.id}
                  className="list-item"
                  style={{ marginLeft: 'var(--spacing-md)', borderBottom: 'none', paddingBottom: 0 }}
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  onMouseEnter={() => setHoveredId(item.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Header */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between'
                  }}>
                    <span style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      overflow: isExpanded ? 'visible' : 'hidden',
                      flex: 1
                    }}>
                      <span
                        style={{
                          cursor: 'text',
                          ...(isExpanded ? {
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap'
                          } : {
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          })
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {userQuery}
                      </span>
                      {(isHovered || isExpanded) && (
                        isExpanded ? (
                          <MdExpandMore size={16} style={{ flexShrink: 0, marginLeft: '4px' }} />
                        ) : (
                          <MdChevronRight size={16} style={{ flexShrink: 0, marginLeft: '4px' }} />
                        )
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--color-text-muted)',
                        marginLeft: 'var(--spacing-md)',
                        cursor: 'text',
                        flexShrink: 0
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {new Date(item.created_at).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div
                      style={{
                        marginTop: 'var(--spacing-sm)',
                        fontSize: 'var(--font-size-sm)',
                        lineHeight: 1.6,
                        cursor: 'text'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Selected text (if any) */}
                      {contextText && (
                        <span style={{
                          fontSize: 'var(--font-size-xs)',
                          color: 'var(--color-text-muted)',
                          marginBottom: 'var(--spacing-sm)',
                          padding: '2px 6px',
                          background: 'var(--color-surface)',
                          borderRadius: '4px',
                          border: '1px solid var(--color-border)',
                          display: 'inline-block',
                          fontStyle: 'italic',
                          maxWidth: '100%',
                          wordBreak: 'break-word'
                        }}>
                          {truncate(contextText, 100)}
                        </span>
                      )}

                      {/* Agent trace - human readable actions */}
                      {item.actions && item.actions.length > 0 && (
                        <div style={{
                          marginTop: 'var(--spacing-sm)',
                          borderLeft: '2px solid var(--color-border)',
                          paddingLeft: 'var(--spacing-sm)',
                          marginLeft: '2px'
                        }}>
                          {item.actions.map((action, idx) => (
                            <div key={idx} style={{
                              fontSize: 'var(--font-size-xs)',
                              marginBottom: 'var(--spacing-xs)',
                              color: 'var(--color-accent)',
                              wordBreak: 'break-word'
                            }}>
                              {formatAction(action)}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Final response */}
                      {item.response && (
                        <div
                          className="markdown-content"
                          style={{
                            marginTop: 'var(--spacing-sm)',
                            color: 'var(--color-accent)',
                            fontSize: 'var(--font-size-xs)',
                            lineHeight: 1.5,
                            wordBreak: 'break-word',
                          }}
                          dangerouslySetInnerHTML={{ __html: marked.parse(item.response, { async: false, breaks: true, gfm: true }) as string }}
                        />
                      )}
                    </div>
                  )}
                  {/* Separator line aligned with content */}
                  {!isLastItem && (
                    <div style={{
                      height: '1px',
                      backgroundColor: 'var(--color-border)',
                      marginTop: 'var(--spacing-md)'
                    }} />
                  )}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

export default HistoryPanel;
