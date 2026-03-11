import React from 'react';
import { MdChevronRight, MdExpandMore } from 'react-icons/md';
import { marked } from 'marked';
import { HistoryItem } from './history-types';
import { formatAction, parseQuery, formatTime } from './history-utils';

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
  onToggle: () => void;
  onHover: (hovered: boolean) => void;
  cardRef: (el: HTMLElement | null) => void;
}

export default function HistoryCard({
  item, isLast, isExpanded, isHovered, isActiveMatch, onToggle, onHover, cardRef
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
                  <div key={idx} className="history-card-trace-step">
                    {formatAction(action)}
                  </div>
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
