export interface ActionData {
  tool: string;
  input: unknown;
  timestamp: number;
}

export interface HistoryItem {
  id: number;
  query: string;
  response: string;
  created_at: number;
  tools_used?: string[] | null;
  agent_type?: string;
  actions?: ActionData[] | null;
  context_text?: string | null;
}

export interface GroupedHistory {
  [date: string]: HistoryItem[];
}

export interface UserProfile {
  email: string;
  uid: string;
  displayName: string | null;
  photoUrl: string | null;
  provider: string | null;
}
