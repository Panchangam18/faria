import { ActionData, HistoryItem, GroupedHistory } from './history-types';

function truncate(text: string | undefined | null, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

function formatComputerAction(a: {
  type: string;
  text?: string;
  key?: string;
  app?: string;
  query?: string;
  x?: number;
  y?: number;
  coordinate?: number[];
}): string {
  switch (a.type) {
    case 'type': return `typed "${truncate(a.text, 30)}"`;
    case 'key': return `pressed ${a.key}`;
    case 'hotkey': return 'pressed hotkey';
    case 'activate': return `activated ${a.app}`;
    case 'click':
      if (a.coordinate) return `clicked at (${a.coordinate[0]}, ${a.coordinate[1]})`;
      if (a.x !== undefined && a.y !== undefined) return `clicked at (${a.x}, ${a.y})`;
      return 'clicked';
    case 'right_click': return 'right-clicked';
    case 'double_click': return 'double-clicked';
    case 'scroll': return 'scrolled';
    case 'drag': return 'dragged';
    case 'wait': return 'waited';
    case 'screenshot': return 'took screenshot';
    case 'insert_image': return `inserted image "${truncate(a.query, 30)}"`;
    case 'applescript': return 'ran AppleScript';
    case 'mouse_move': return 'moved mouse';
    default: return a.type;
  }
}

function formatComposioTool(input: Record<string, unknown>): string {
  const tools = input.tools as Array<{ tool_slug?: string; arguments?: Record<string, unknown> }>;
  if (!tools?.length) return 'Execute integration';

  const { tool_slug = '', arguments: toolArgs = {} } = tools[0];
  const displayName = tool_slug
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  const detailFields = [
    'recipient_email', 'subject', 'to', 'message', 'title', 'query', 'calendarId', 'timezone'
  ] as const;

  const details: string[] = [];
  for (const field of detailFields) {
    if (toolArgs[field]) {
      const prefix = ['subject', 'message', 'title', 'query'].includes(field) ? '' : `${field}: `;
      const val = String(toolArgs[field]);
      details.push(prefix ? `${prefix}${val}` : `"${truncate(val, 30)}"`);
    }
  }

  return details.length > 0
    ? `${displayName} (${details.slice(0, 2).join(', ')})`
    : displayName;
}

function formatUnknownTool(action: ActionData): string {
  const input = action.input as Record<string, unknown>;
  const toolName = action.tool
    .replace(/^COMPOSIO_/i, '')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());

  const meaningfulFields = ['query', 'text', 'message', 'content', 'name', 'title', 'url', 'path', 'body', 'subject'];
  for (const field of meaningfulFields) {
    if (input[field] && typeof input[field] === 'string') {
      return `${toolName}: "${truncate(input[field] as string, 50)}"`;
    }
  }

  const firstKey = Object.keys(input)[0];
  if (firstKey && typeof input[firstKey] === 'string' && (input[firstKey] as string).length > 0) {
    return `${toolName}: ${truncate(input[firstKey] as string, 40)}`;
  }
  return toolName;
}

export function formatAction(action: ActionData): string {
  const input = action.input as Record<string, unknown>;

  switch (action.tool) {
    case 'web_search':
      return `Searched web for "${truncate(input.query as string, 50)}"`;

    case 'make_edit':
    case 'suggest_edits': {
      const edits = input.edits as Array<{ newText?: string }>;
      return edits?.[0]?.newText
        ? `Made edit: "${truncate(edits[0].newText, 60)}"`
        : 'Made edit';
    }

    case 'insert_image':
      return `Inserted image: "${truncate(input.query as string, 50)}"`;

    case 'answer':
      return `Answered: "${truncate(input.text as string, 80)}"`;

    case 'replace_selected_text':
      return `Replaced text with: "${truncate(input.text as string, 60)}"`;

    case 'execute_python': {
      const code = input.code as string;
      return code
        ? `Executed Python: ${truncate(code.split('\n')[0], 50)}`
        : 'Executed Python code';
    }

    case 'computer_actions': {
      const actions = input.actions as Array<{
        type: string; text?: string; key?: string; app?: string;
        query?: string; x?: number; y?: number; coordinate?: number[];
      }>;
      return actions?.length
        ? actions.map(formatComputerAction).join(' → ')
        : 'Performed actions';
    }

    case 'get_state':
      return 'Retrieved app state';

    case 'computer':
      return `Computer: ${input.action}`;

    case 'COMPOSIO_SEARCH_TOOLS': {
      const queries = input.queries as Array<{ use_case?: string }>;
      return queries?.[0]?.use_case
        ? `Search tools: "${truncate(queries[0].use_case, 50)}"`
        : 'Search tools';
    }

    case 'COMPOSIO_MULTI_EXECUTE_TOOL':
      return formatComposioTool(input);

    default:
      return formatUnknownTool(action);
  }
}

export function parseQuery(queryString: string): string {
  const match = queryString.match(/^"([^"]+)"(?:\s+"[^"]*")?$/);
  return match ? match[1] : queryString;
}

export function getFirstName(profile?: { displayName: string | null; email: string } | null): string | null {
  if (!profile) return null;
  if (profile.displayName) return profile.displayName.split(' ')[0];
  if (profile.email) return profile.email.split('@')[0];
  return null;
}

export function groupByDate(items: HistoryItem[]): GroupedHistory {
  const groups: GroupedHistory = {};
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const item of items) {
    const itemDate = new Date(item.created_at).toDateString();
    const groupName = itemDate === today ? 'Today'
      : itemDate === yesterday ? 'Yesterday'
      : new Date(item.created_at).toLocaleDateString('en-US', {
          weekday: 'long', month: 'short', day: 'numeric',
        });

    (groups[groupName] ??= []).push(item);
  }

  return groups;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
