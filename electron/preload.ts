import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('faria', {
  // Agent
  agent: {
    submit: (query: string) => ipcRenderer.invoke('agent:submit', query),
    cancel: () => ipcRenderer.invoke('agent:cancel'),
    authCompleted: () => ipcRenderer.send('agent:auth-completed'),
    onStatus: (callback: (status: string) => void) => {
      ipcRenderer.on('agent:status', (_event, status) => callback(status));
    },
    onResponse: (callback: (response: string) => void) => {
      ipcRenderer.on('agent:response', (_event, response) => callback(response));
    },
    onChunk: (callback: (chunk: string) => void) => {
      ipcRenderer.on('agent:chunk', (_event, chunk) => callback(chunk));
    },
    onAuthRequired: (callback: (data: { toolkit: string; redirectUrl: string }) => void) => {
      ipcRenderer.on('agent:auth-required', (_event, data) => callback(data));
    },
    onToolApprovalRequired: (callback: (data: { toolName: string; toolDescription: string; args: Record<string, unknown>; isComposio: boolean; displayName?: string; details?: Record<string, string> }) => void) => {
      ipcRenderer.on('agent:tool-approval-required', (_event, data) => callback(data));
    },
    toolApprovalResponse: (approved: boolean) => ipcRenderer.send('agent:tool-approval-response', approved)
  },

  // State
  state: {
    extract: () => ipcRenderer.invoke('state:extract')
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    getDefaultPrompt: () => ipcRenderer.invoke('settings:getDefaultPrompt'),
    onThemeChange: (callback: (themeData: { theme: string; customColors?: { background: string; text: string; accent: string }; font: string }) => void) => {
      ipcRenderer.on('settings:theme-change', (_event, themeData) => callback(themeData));
    }
  },

  // History
  history: {
    get: () => ipcRenderer.invoke('history:get'),
    add: (query: string, response: string) => ipcRenderer.invoke('history:add', query, response)
  },

  // Shortcuts
  shortcuts: {
    reregister: () => ipcRenderer.invoke('shortcuts:reregister'),
  },

  // Integrations - Composio connection management
  integrations: {
    getConnections: () => ipcRenderer.invoke('integrations:list'),
    deleteConnection: (id: string) => ipcRenderer.invoke('integrations:delete', id),
    getAvailableApps: () => ipcRenderer.invoke('integrations:apps'),
    initiateConnection: (appName: string) => ipcRenderer.invoke('integrations:connect', appName)
  },

  // Shell - Open external URLs in default browser
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url)
  },

  // Command Bar
  commandBar: {
    hide: () => ipcRenderer.send('command-bar:hide'),
    resize: (height: number) => ipcRenderer.send('command-bar:resize', height),
    setDropdownVisible: (visible: boolean) => ipcRenderer.send('command-bar:dropdown-visible', visible),
    onFocus: (callback: () => void) => {
      ipcRenderer.on('command-bar:focus', () => callback());
    },
    onDetecting: (callback: () => void) => {
      ipcRenderer.on('command-bar:detecting', () => callback());
    },
    onReady: (callback: (data: { hasSelectedText: boolean; selectedTextLength: number }) => void) => {
      ipcRenderer.on('command-bar:ready', (_event, data) => callback(data));
    },
    onError: (callback: (error: string) => void) => {
      ipcRenderer.on('command-bar:error', (_event, error) => callback(error));
    },
    onWillHide: (callback: () => void) => {
      ipcRenderer.on('command-bar:will-hide', () => callback());
    },
    onReset: (callback: () => void) => {
      ipcRenderer.on('command-bar:reset', () => callback());
    }
  }
});

// Type definitions for the exposed API
export interface FariaAPI {
  agent: {
    submit: (query: string) => Promise<{ success: boolean; result?: string; error?: string }>;
    cancel: () => Promise<{ success: boolean }>;
    authCompleted: () => void;
    onStatus: (callback: (status: string) => void) => void;
    onResponse: (callback: (response: string) => void) => void;
    onChunk: (callback: (chunk: string) => void) => void;
    onAuthRequired: (callback: (data: { toolkit: string; redirectUrl: string }) => void) => void;
    onToolApprovalRequired: (callback: (data: { toolName: string; toolDescription: string; args: Record<string, unknown>; isComposio: boolean; displayName?: string; details?: Record<string, string> }) => void) => void;
    toolApprovalResponse: (approved: boolean) => void;
  };
  state: {
    extract: () => Promise<{ success: boolean; state?: unknown; error?: string }>;
  };
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<{ success: boolean }>;
    getDefaultPrompt: () => Promise<string>;
    onThemeChange: (callback: (themeData: { theme: string; customColors?: { background: string; text: string; accent: string }; font: string }) => void) => void;
  };
  history: {
    get: () => Promise<Array<{
      id: number;
      query: string;
      response: string;
      created_at: number; // Unix timestamp in milliseconds
    }>>;
    add: (query: string, response: string) => Promise<{ success: boolean }>;
  };
  shortcuts: {
    reregister: () => Promise<{ success: boolean }>;
  };
  integrations: {
    getConnections: () => Promise<Array<{
      id: string;
      appName: string;
      displayName: string;
      status: string;
      logo?: string;
      createdAt?: string;
    }>>;
    deleteConnection: (id: string) => Promise<boolean>;
    getAvailableApps: () => Promise<Array<{
      name: string;
      displayName: string;
      logo?: string;
      categories?: string[];
    }>>;
    initiateConnection: (appName: string) => Promise<{ redirectUrl: string } | null>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  commandBar: {
    hide: () => void;
    resize: (height: number) => void;
    setDropdownVisible: (visible: boolean) => void;
    onFocus: (callback: () => void) => void;
    onDetecting: (callback: () => void) => void;
    onReady: (callback: (data: { hasSelectedText: boolean; selectedTextLength: number }) => void) => void;
    onError: (callback: (error: string) => void) => void;
    onWillHide: (callback: () => void) => void;
    onReset: (callback: () => void) => void;
  };
}

declare global {
  interface Window {
    faria: FariaAPI;
  }
}
