import React, { useState, useEffect } from 'react';
import { MdDescription, MdChevronRight, MdExpandMore } from 'react-icons/md';

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
 * Format an action into human-readable text
 */
function formatAction(action: ActionData): string {
  const input = action.input as Record<string, unknown>;

  switch (action.tool) {
    case 'web_search':
      return `Searched web for "${input.query}"`;

    case 'make_edit':
    case 'suggest_edits': {
      const edits = input.edits as Array<{ oldText?: string; newText?: string }>;
      if (edits && edits.length > 0) {
        const edit = edits[0];
        const newText = edit.newText || '';
        return `Made edit: "${newText}"`;
      }
      return 'Made edit';
    }

    case 'insert_image':
      return `Inserted image: "${input.query}"`;

    case 'answer':
      return `Answered: "${(input.text as string)?.substring(0, 80)}${(input.text as string)?.length > 80 ? '...' : ''}"`;

    case 'computer_actions': {
      const actions = input.actions as Array<{ type: string; text?: string; key?: string; app?: string }>;
      if (actions && actions.length > 0) {
        const summary = actions.map(a => {
          if (a.type === 'type') return `typed "${a.text?.substring(0, 30)}${(a.text?.length || 0) > 30 ? '...' : ''}"`;
          if (a.type === 'key') return `pressed ${a.key}`;
          if (a.type === 'hotkey') return `pressed hotkey`;
          if (a.type === 'activate') return `activated ${a.app}`;
          if (a.type === 'click') return 'clicked';
          return a.type;
        }).join(', ');
        return `Performed actions: ${summary}`;
      }
      return 'Performed chain of actions';
    }

    case 'get_state':
      return 'Retrieved app state';

    case 'computer':
      return `Computer action: ${input.action}`;

    default:
      return `${action.tool}`;
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
            }}>⌘ /</kbd> to open Faria
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
                  {/* Collapsed header */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      overflow: 'hidden',
                      flex: 1
                    }}>
                      <span
                        style={{
                          cursor: 'text',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
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
                        <div style={{
                          fontSize: 'var(--font-size-xs)',
                          fontStyle: 'italic',
                          color: 'var(--color-text-muted)',
                          marginBottom: 'var(--spacing-md)',
                          wordBreak: 'break-word',
                          whiteSpace: 'pre-wrap'
                        }}>
                          {contextText}
                        </div>
                      )}

                      {/* Agent trace - human readable actions */}
                      {item.actions && item.actions.length > 0 && (
                        <div style={{
                          marginTop: 'var(--spacing-sm)'
                        }}>
                          {item.actions.map((action, idx) => (
                            <div key={idx} style={{
                              fontSize: 'var(--font-size-xs)',
                              color: 'var(--color-accent)',
                              marginBottom: 'var(--spacing-xs)'
                            }}>
                              {formatAction(action)}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Response (if no actions, or as final result) */}
                      {(!item.actions || item.actions.length === 0) && item.response && (
                        <div style={{
                          marginTop: 'var(--spacing-sm)',
                          color: 'var(--color-accent)',
                          fontSize: 'var(--font-size-xs)'
                        }}>
                          {item.response}
                        </div>
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
