import React, { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';

interface HistoryItem {
  id: number;
  query: string;
  response: string;
  created_at: number; // Unix timestamp in milliseconds
}

interface GroupedHistory {
  [date: string]: HistoryItem[];
}

function HistoryPanel() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    const items = await window.faria.history.get();
    setHistory(items);
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

  if (history.length === 0) {
    return (
      <div className="history-panel">
        <div className="empty-state">
          <div className="empty-state-icon">
            <FileText size={48} strokeWidth={1.5} />
          </div>
          <p>No queries yet</p>
          <p style={{ fontSize: 'var(--font-size-sm)', marginTop: 'var(--spacing-sm)' }}>
            Press <kbd style={{ 
              background: 'var(--color-surface)', 
              padding: '2px 6px', 
              borderRadius: '4px',
              border: '1px solid var(--color-border)'
            }}>⌘ ⇧ Space</kbd> to open Faria
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
          <div className="card">
            {items.map((item) => (
              <div
                key={item.id}
                className="list-item"
                onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
              >
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between' 
                }}>
                  <span style={{ 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis', 
                    whiteSpace: 'nowrap',
                    flex: 1
                  }}>
                    {item.query}
                  </span>
                  <span style={{ 
                    fontSize: 'var(--font-size-xs)', 
                    color: 'var(--color-text-muted)',
                    marginLeft: 'var(--spacing-md)'
                  }}>
                    {new Date(item.created_at).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                
                {expandedId === item.id && (
                  <div style={{ 
                    marginTop: 'var(--spacing-md)',
                    paddingTop: 'var(--spacing-md)',
                    borderTop: '1px solid var(--color-border)',
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-muted)',
                    lineHeight: 1.6
                  }}>
                    {item.response}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default HistoryPanel;

