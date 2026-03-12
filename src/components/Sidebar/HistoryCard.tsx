import React from 'react';
import { MdChevronRight, MdExpandMore } from 'react-icons/md';
import { marked } from 'marked';
import { HistoryItem } from './history-types';
import { formatAction, getToolIcon, parseQuery, formatTime } from './history-utils';

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

interface HistoryCardProps {
  item: HistoryItem;
  isLast: boolean;
  isExpanded: boolean;
  isHovered: boolean;
  isActiveMatch: boolean;
  appLogos: Map<string, string>;
  onToggle: () => void;
  onHover: (hovered: boolean) => void;
  cardRef: (el: HTMLElement | null) => void;
}

function getAppLogo(toolName: string, input: unknown, appLogos: Map<string, string>): string | null {
  // For COMPOSIO_MULTI_EXECUTE_TOOL, dig into input.tools[0].tool_slug
  if (toolName === 'COMPOSIO_MULTI_EXECUTE_TOOL') {
    const inp = input as Record<string, unknown>;
    const tools = inp.tools as Array<{ tool_slug?: string }> | undefined;
    const slug = tools?.[0]?.tool_slug;
    if (slug) {
      const appName = slug.split('_')[0].toLowerCase();
      return appLogos.get(appName) || null;
    }
  }
  // For directly named tools: GMAIL_SEND_EMAIL → gmail
  const parts = toolName.split('_');
  if (parts.length < 2) return null;
  const appName = parts[0].toLowerCase();
  return appLogos.get(appName) || null;
}

export default function HistoryCard({
  item, isLast, isExpanded, isHovered, isActiveMatch, appLogos, onToggle, onHover, cardRef
}: HistoryCardProps) {
  const userQuery = parseQuery(item.query);
  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className={`history-timeline-item${isLast ? ' history-timeline-item--last' : ''}`}>
      <div
        ref={cardRef}
        className={`history-card${isActiveMatch ? ' find-active-match' : ''}`}
        onClick={onToggle}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
      >
        <div className="history-card-header">
          <span className="history-card-query-wrap">
            <span
              className={`history-card-query ${isExpanded ? 'history-card-query--expanded' : ''}`}
              onClick={stopPropagation}
            >
              {userQuery}
            </span>
            {(isHovered || isExpanded) && (
              isExpanded
                ? <MdExpandMore size={16} className="history-card-chevron" />
                : <MdChevronRight size={16} className="history-card-chevron" />
            )}
          </span>
          <span className="history-card-time" onClick={stopPropagation}>
            {formatTime(item.created_at)}
          </span>
        </div>

        {isExpanded && (
          <div className="history-card-body" onClick={stopPropagation}>
            {item.context_text && (
              <span className="history-card-context">
                {truncate(item.context_text, 100)}
              </span>
            )}

            {item.actions && item.actions.length > 0 && (
              <div className="history-card-trace">
                {item.actions.map((action, idx) => (
                  action.tool === '_thinking' ? (
                    <div
                      key={idx}
                      className="markdown-content history-card-response"
                      style={{ width: '100%' }}
                      dangerouslySetInnerHTML={{
                        __html: marked.parse((action.input as Record<string, string>).text, { async: false, breaks: true, gfm: true }) as string
                      }}
                    />
                  ) : (
                    <div key={idx} className="tool-bubble">
                      <span className="tool-bubble-icon">
                        {(() => {
                          const logo = getAppLogo(action.tool, action.input, appLogos);
                          return logo
                            ? <img src={logo} alt="" style={{ width: 12, height: 12, objectFit: 'contain', borderRadius: 2 }} />
                            : getToolIcon(action.tool);
                        })()}
                      </span>
                      <span className="tool-bubble-text">{formatAction(action)}</span>
                    </div>
                  )
                ))}
              </div>
            )}

            {item.response && (
              <div
                className="markdown-content history-card-response"
                dangerouslySetInnerHTML={{
                  __html: marked.parse(item.response, { async: false, breaks: true, gfm: true }) as string
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
