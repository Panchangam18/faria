import { useLayoutEffect, useRef, MutableRefObject } from 'react';
import { LINE_HEIGHT, MAX_TEXTAREA_HEIGHT, BASE_HEIGHT, MAX_AGENT_AREA_HEIGHT } from './utils';
import { AgentState } from './types';

export function useCommandBarResize(
  inputRef: MutableRefObject<HTMLTextAreaElement | null>,
  agentAreaRef: MutableRefObject<HTMLDivElement | null>,
  query: string,
  agent: AgentState,
) {
  const lastResizeRef = useRef<{ total: number; agentAreaHeight: number }>({ total: 0, agentAreaHeight: 0 });
  const textareaHeightRef = useRef(LINE_HEIGHT);

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

  // Measure agent area and calculate total window height
  useLayoutEffect(() => {
    let agentAreaHeight = 0;
    if (agentAreaRef.current) {
      // Force max-height constraint before measuring to prevent overflow flash
      agentAreaRef.current.style.maxHeight = `${MAX_AGENT_AREA_HEIGHT}px`;
      agentAreaHeight = Math.min(agentAreaRef.current.scrollHeight, MAX_AGENT_AREA_HEIGHT);
    }

    const totalHeight = BASE_HEIGHT + textareaHeightRef.current + agentAreaHeight;
    const last = lastResizeRef.current;
    if (totalHeight !== last.total || agentAreaHeight !== last.agentAreaHeight) {
      lastResizeRef.current = { total: totalHeight, agentAreaHeight };
      // Call resize synchronously — no RAF delay to prevent one-frame flash
      window.faria.commandBar.resize({ total: totalHeight, agentAreaHeight });
    }
  }, [agent.response, agent.streamingResponse, agent.status, agent.pendingToolApproval, agent.pendingAuth, agent.toolApprovalExpanded]);
}
