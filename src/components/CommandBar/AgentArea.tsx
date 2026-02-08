import React from 'react';
import { PendingAuth, PendingToolApproval } from './types';
import { formatToolkitName } from './utils';

function getApprovalLabel(approval: PendingToolApproval): string {
  return approval.displayName || (approval.isComposio
    ? `Use ${formatToolkitName(approval.toolName.split('_')[0])}`
    : 'Allow computer control?');
}

function hasDetails(approval: PendingToolApproval): boolean {
  return !!(approval.details && Object.keys(approval.details).length > 0);
}

export function ToolApprovalView({
  approval,
  expanded,
  onToggleExpanded,
  onApprove,
  toolApprovalRef,
}: {
  approval: PendingToolApproval;
  expanded: boolean;
  onToggleExpanded: () => void;
  onApprove: () => void;
  toolApprovalRef: React.RefObject<HTMLDivElement>;
}) {
  const label = getApprovalLabel(approval);
  const showDetails = hasDetails(approval);

  return (
    <div className="command-bar-tool-approval" ref={toolApprovalRef}>
      <div className="tool-approval-header">
        {showDetails ? (
          <button className="tool-approval-toggle" onClick={onToggleExpanded}>
            <span className="tool-approval-shortcut">&#8679;&#8677;</span>
            <span className="tool-approval-name">{label}</span>
            <svg
              className={`chevron ${expanded ? 'open' : ''}`}
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M2 3.5L5 6.5L8 3.5" />
            </svg>
          </button>
        ) : (
          <span className="tool-approval-name-static">{label}</span>
        )}
        <div className="tool-approval-buttons">
          <button className="auth-inline-button auth-inline-connect" onClick={onApprove}>
            <span className="button-shortcut">↵</span> Allow
          </button>
        </div>
      </div>
      {showDetails && (
        <div className={`tool-approval-details ${expanded ? 'expanded' : ''}`}>
          {Object.entries(approval.details!).map(([key, value]) => (
            <div key={key || 'content'} className="tool-approval-detail">
              {key ? <><span className="detail-key">{key}:</span> {value}</> : value}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AuthView({
  pendingAuth,
  onOpenUrl,
  onComplete,
}: {
  pendingAuth: PendingAuth;
  onOpenUrl: () => void;
  onComplete: () => void;
}) {
  return (
    <div className="command-bar-auth-inline">
      <span className="auth-status-text" style={{ fontStyle: 'normal' }}>
        Faria wants to use {formatToolkitName(pendingAuth.toolkit)}
      </span>
      <button className="auth-inline-button auth-inline-connect" onClick={onOpenUrl}>
        Connect
      </button>
      <button className="auth-inline-button auth-inline-done" onClick={onComplete}>
        Done
      </button>
    </div>
  );
}

export function StatusView({ status }: { status: string }) {
  return (
    <div className="command-bar-status">
      <div className="status-spinner" />
      <span>{status}</span>
    </div>
  );
}

export function ResponseView({
  errorMessage,
  response,
  streamingResponse,
  responseRef,
}: {
  errorMessage: string | null;
  response: string;
  streamingResponse: string;
  responseRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div
      className="command-bar-response"
      ref={responseRef}
      style={errorMessage ? { color: 'var(--color-error, #ff4444)' } : undefined}
    >
      {errorMessage || response || streamingResponse}
    </div>
  );
}
