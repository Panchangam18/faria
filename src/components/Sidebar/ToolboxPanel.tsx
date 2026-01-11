import React, { useState, useEffect } from 'react';

interface CustomTool {
  id: string;
  name: string;
  description: string;
  parameters: string;
  code: string;
  created_at: string;
  usage_count: number;
}

function ToolboxPanel() {
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    loadTools();
  }, []);

  const loadTools = async () => {
    const items = await window.faria.tools.list();
    setTools(items);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this tool?')) {
      await window.faria.tools.delete(id);
      loadTools();
    }
  };

  if (tools.length === 0) {
    return (
      <div className="toolbox-panel">
        <h2 className="panel-title">Toolbox</h2>
        <div className="empty-state">
          <div className="empty-state-icon">🧰</div>
          <p>No custom tools yet</p>
          <p style={{ fontSize: 'var(--font-size-sm)', marginTop: 'var(--spacing-sm)' }}>
            Faria will create tools automatically when it learns new skills
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="toolbox-panel">
      <h2 className="panel-title">Toolbox</h2>
      
      <div className="card">
        {tools.map((tool) => (
          <div
            key={tool.id}
            className="list-item"
            onClick={() => setExpandedId(expandedId === tool.id ? null : tool.id)}
          >
            <div style={{ 
              display: 'flex', 
              alignItems: 'flex-start', 
              justifyContent: 'space-between',
              gap: 'var(--spacing-md)'
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ 
                  fontWeight: 600, 
                  marginBottom: 'var(--spacing-xs)',
                  fontFamily: 'var(--font-family-mono)'
                }}>
                  {tool.name}
                </div>
                <div style={{ 
                  fontSize: 'var(--font-size-sm)', 
                  color: 'var(--color-text-muted)' 
                }}>
                  {tool.description}
                </div>
              </div>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 'var(--spacing-sm)' 
              }}>
                <span style={{ 
                  fontSize: 'var(--font-size-xs)', 
                  color: 'var(--color-text-muted)' 
                }}>
                  Used {tool.usage_count}x
                </span>
                <button
                  onClick={(e) => handleDelete(tool.id, e)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    padding: 'var(--spacing-xs)',
                    fontSize: '16px'
                  }}
                  title="Delete tool"
                >
                  🗑️
                </button>
              </div>
            </div>
            
            {expandedId === tool.id && (
              <div style={{ marginTop: 'var(--spacing-md)' }}>
                <div style={{ 
                  fontSize: 'var(--font-size-xs)', 
                  color: 'var(--color-text-muted)',
                  marginBottom: 'var(--spacing-xs)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}>
                  Parameters
                </div>
                <pre style={{ 
                  fontSize: 'var(--font-size-xs)',
                  marginBottom: 'var(--spacing-md)'
                }}>
                  {tool.parameters}
                </pre>
                
                <div style={{ 
                  fontSize: 'var(--font-size-xs)', 
                  color: 'var(--color-text-muted)',
                  marginBottom: 'var(--spacing-xs)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}>
                  Code
                </div>
                <pre style={{ fontSize: 'var(--font-size-xs)' }}>
                  {tool.code}
                </pre>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ToolboxPanel;

