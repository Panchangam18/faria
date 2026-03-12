import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { MdDescription } from 'react-icons/md';
import { IoCalendarOutline, IoChatbubblesOutline, IoFlashOutline } from 'react-icons/io5';
import { HistoryItem, UserProfile } from './history-types';
import { getFirstName, groupByDate } from './history-utils';
import FindWidget from './FindWidget';
import HistoryCard from './HistoryCard';

interface HistoryPanelProps {
  userProfile?: UserProfile | null;
}

function HistoryPanel({ userProfile }: HistoryPanelProps) {
  const firstName = getFirstName(userProfile);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const greetingRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const matchRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Track greeting height for sticky date positioning
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const el = greetingRef.current;
    if (!panel) return;
    if (!el) {
      panel.style.setProperty('--date-sticky-top', '0px');
      panel.style.setProperty('--greeting-height', '0px');
      return;
    }
    const scrollContainer = panel.closest('.main-panel') as HTMLElement | null;
    const update = () => {
      const h = el.offsetHeight;
      panel.style.setProperty('--greeting-height', `${h}px`);
      const paddingTop = scrollContainer ? parseFloat(getComputedStyle(scrollContainer).paddingTop) : 0;
      panel.style.setProperty('--date-sticky-top', `${h - paddingTop - 1}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [firstName, loading]);

  // Load history on mount and on new responses
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const items = await window.faria.history.get();
      setHistory(items);
      if (items.length > 0) setExpandedId(items[0].id);
      setLoading(false);
    };
    load();
    return window.faria.agent.onResponse(() => load());
  }, []);

  // Filter history by search
  const filteredHistory = useMemo(() => {
    if (!searchQuery) return history;
    const q = searchQuery.toLowerCase();
    return history.filter(item =>
      item.query.toLowerCase().includes(q) ||
      item.response?.toLowerCase().includes(q) ||
      item.context_text?.toLowerCase().includes(q)
    );
  }, [history, searchQuery]);

  const matchCount = filteredHistory.length;

  // Reset match index on query change
  useEffect(() => setActiveMatchIndex(0), [searchQuery]);

  // Scroll active match into view
  useEffect(() => {
    if (!searchQuery || matchCount === 0) return;
    const item = filteredHistory[activeMatchIndex];
    if (item) matchRefs.current.get(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeMatchIndex, searchQuery, matchCount]);

  const goToNext = () => { if (matchCount > 0) setActiveMatchIndex(i => (i + 1) % matchCount); };
  const goToPrev = () => { if (matchCount > 0) setActiveMatchIndex(i => (i - 1 + matchCount) % matchCount); };

  // Keyboard shortcuts: Cmd+F, Escape, Enter/Shift+Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        if (searchOpen) { setSearchOpen(false); setSearchQuery(''); }
        else { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 0); }
      }
      if (e.key === 'Escape' && searchOpen) { setSearchOpen(false); setSearchQuery(''); }
      if (searchOpen && e.key === 'Enter' && document.activeElement === searchInputRef.current) {
        e.preventDefault();
        e.shiftKey ? goToPrev() : goToNext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, matchCount, activeMatchIndex]);

  // Compute user stats
  const stats = useMemo(() => {
    if (history.length === 0) return null;
    const oldest = Math.min(...history.map(h => h.created_at));
    const now = Date.now();
    const diffMs = now - oldest;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    let streakLabel: string;
    if (diffDays >= 365) {
      const years = Math.floor(diffDays / 365);
      streakLabel = `${years} ${years === 1 ? 'year' : 'years'}`;
    } else if (diffDays >= 7) {
      const weeks = Math.floor(diffDays / 7);
      streakLabel = `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
    } else {
      streakLabel = `${Math.max(diffDays, 1)} ${diffDays === 1 ? 'day' : 'days'}`;
    }

    const totalActions = history.reduce((sum, h) => sum + (h.actions?.length ?? 0), 0);

    return { streakLabel, chatCount: history.length, totalActions };
  }, [history]);

  const grouped = groupByDate(filteredHistory);

  if (loading) {
    return (
      <div className="history-panel">
        <div className="empty-state">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="history-panel">
        <div className="empty-state">
          <div className="empty-state-icon"><MdDescription size={48} /></div>
          <p>No queries yet</p>
          <p className="empty-state-hint">
            Press <kbd className="kbd">&#8984; &#9166;</kbd> to open Faria
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={panelRef} className="history-panel" style={{ paddingBottom: 'var(--spacing-lg)' }}>
      {firstName && (
        <div ref={greetingRef} className="history-greeting">
          <span className="greeting-text">Good day, {firstName}</span>
          {stats && (
            <div className="greeting-stats">
              <div className="greeting-stat">
                <IoCalendarOutline size={12} />
                <span className="greeting-stat-value">{stats.streakLabel}</span>
                <span className="greeting-stat-label">aboard</span>
              </div>
              <div className="greeting-stat">
                <IoChatbubblesOutline size={12} />
                <span className="greeting-stat-value">{stats.chatCount}</span>
                <span className="greeting-stat-label">convos</span>
              </div>
              <div className="greeting-stat">
                <IoFlashOutline size={12} />
                <span className="greeting-stat-value">{stats.totalActions}</span>
                <span className="greeting-stat-label">actions</span>
              </div>
            </div>
          )}
        </div>
      )}

      {searchOpen && (
        <FindWidget
          query={searchQuery}
          onChange={setSearchQuery}
          onClose={() => { setSearchOpen(false); setSearchQuery(''); }}
          onNext={goToNext}
          onPrev={goToPrev}
          matchCount={matchCount}
          activeIndex={activeMatchIndex}
          inputRef={searchInputRef}
        />
      )}

      {Object.entries(grouped).map(([date, items]) => (
        <React.Fragment key={date}>
          <div className="date-group-title">{date}</div>
          <div className="history-timeline">
            {items.map((item, index) => (
              <HistoryCard
                key={item.id}
                item={item}
                isLast={index === items.length - 1}
                isExpanded={expandedId === item.id}
                isHovered={hoveredId === item.id}
                isActiveMatch={!!searchQuery && filteredHistory[activeMatchIndex]?.id === item.id}
                onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                onHover={(h) => h ? setHoveredId(item.id) : setHoveredId(null)}
                cardRef={(el) => {
                  if (el) matchRefs.current.set(item.id, el);
                  else matchRefs.current.delete(item.id);
                }}
              />
            ))}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

export default HistoryPanel;
