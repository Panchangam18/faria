import React from 'react';
import { MdClose, MdKeyboardArrowUp, MdKeyboardArrowDown } from 'react-icons/md';

interface FindWidgetProps {
  query: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onNext: () => void;
  onPrev: () => void;
  matchCount: number;
  activeIndex: number;
  inputRef: React.RefObject<HTMLInputElement>;
}

export default function FindWidget({
  query, onChange, onClose, onNext, onPrev, matchCount, activeIndex, inputRef
}: FindWidgetProps) {
  return (
    <div className="find-widget">
      <div className="find-widget-input-wrap">
        <input
          ref={inputRef}
          type="text"
          placeholder="Find"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          className="find-widget-input"
        />
        {query && (
          <span className="find-widget-count">
            {matchCount === 0 ? 'No results' : `${activeIndex + 1} of ${matchCount}`}
          </span>
        )}
      </div>
      <button className="find-widget-btn" onClick={onPrev} disabled={matchCount === 0} title="Previous match (Shift+Enter)">
        <MdKeyboardArrowUp size={16} />
      </button>
      <button className="find-widget-btn" onClick={onNext} disabled={matchCount === 0} title="Next match (Enter)">
        <MdKeyboardArrowDown size={16} />
      </button>
      <button className="find-widget-btn" onClick={onClose} title="Close (Escape)">
        <MdClose size={14} />
      </button>
    </div>
  );
}
