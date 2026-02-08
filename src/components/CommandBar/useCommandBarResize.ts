import { useLayoutEffect, useRef, MutableRefObject } from 'react';
import { LINE_HEIGHT, MAX_TEXTAREA_HEIGHT, BASE_HEIGHT, MAX_AGENT_AREA_HEIGHT } from './utils';
import { AgentState } from './types';

export function useCommandBarResize(
  inputRef: MutableRefObject<HTMLTextAreaElement | null>,
  agentAreaRef: MutableRefObject<HTMLDivElement | null>,
  query: string,
  agent: AgentState,
  isVisible: boolean,
) {
  const lastResizeRef = useRef<{ total: number; agentAreaHeight: number }>({ total: 0, agentAreaHeight: 0 });
  const textareaHeightRef = useRef(LINE_HEIGHT);
  const rafRef = useRef(0);

  // Reset cached resize dimensions when command bar hides so the next
  // open always sends a fresh resize IPC to the main process
  useLayoutEffect(() => {
    if (!isVisible) {
      lastResizeRef.current = { total: 0, agentAreaHeight: 0 };
    }
  }, [isVisible]);

  // Measure textarea height when query changes (user typing)
  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    // Collapse to 0 to get true content height
    textarea.style.height = '0px';
    textarea.style.overflow = 'hidden';

    const scrollHeight = textarea.scrollHeight;
    const contentHeight = Math.max(LINE_HEIGHT, Math.min(scrollHeight, MAX_TEXTAREA_HEIGHT));
    textarea.style.height = `${contentHeight}px`;

    // Clear inline overflow so CSS class controls it
    textarea.style.overflow = '';

    if (scrollHeight > MAX_TEXTAREA_HEIGHT) {
      textarea.classList.add('scrollable');
    } else {
      textarea.classList.remove('scrollable');
    }

    textareaHeightRef.current = contentHeight;
  }, [query]);

  // Measure agent area and calculate total window height.
  // Content is kept invisible until the window has resized to prevent flash.
  useLayoutEffect(() => {
    const el = agentAreaRef.current;
    if (!el) return;

    cancelAnimationFrame(rafRef.current);

    const hasContent = el.classList.contains('has-content');
    let agentAreaHeight = 0;

    if (hasContent) {
      // Hide content immediately so it doesn't flash in the un-resized window
      el.style.opacity = '0';
      // Force max-height constraint before measuring to prevent overflow
      el.style.maxHeight = `${MAX_AGENT_AREA_HEIGHT}px`;
      agentAreaHeight = Math.min(el.scrollHeight, MAX_AGENT_AREA_HEIGHT);
    } else {
      el.style.maxHeight = '';
      el.style.opacity = '';
    }

    const totalHeight = BASE_HEIGHT + textareaHeightRef.current + agentAreaHeight;
    const last = lastResizeRef.current;
    if (totalHeight !== last.total || agentAreaHeight !== last.agentAreaHeight) {
      lastResizeRef.current = { total: totalHeight, agentAreaHeight };
      // Send resize IPC — main process will setBounds on next tick
      window.faria.commandBar.resize({ total: totalHeight, agentAreaHeight });
    }

    if (hasContent) {
      // Reveal content after two frames — gives the main process time to
      // process the resize IPC and call setBounds before we show anything
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          if (el) el.style.opacity = '';
        });
      });
    }
  }, [agent.response, agent.streamingResponse, agent.status, agent.pendingToolApproval, agent.pendingAuth, agent.toolApprovalExpanded]);
}
