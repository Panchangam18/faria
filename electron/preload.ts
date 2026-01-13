import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('faria', {
  // Agent
  agent: {
    submit: (query: string) => ipcRenderer.invoke('agent:submit', query),
    cancel: () => ipcRenderer.invoke('agent:cancel'),
    onStatus: (callback: (status: string) => void) => {
      ipcRenderer.on('agent:status', (_event, status) => callback(status));
    },
    onResponse: (callback: (response: string) => void) => {
      ipcRenderer.on('agent:response', (_event, response) => callback(response));
    }
  },

  // State
  state: {
    extract: () => ipcRenderer.invoke('state:extract')
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value)
  },

  // History
  history: {
    get: () => ipcRenderer.invoke('history:get'),
    add: (query: string, response: string) => ipcRenderer.invoke('history:add', query, response)
  },

  // Custom Tools
  tools: {
    list: () => ipcRenderer.invoke('tools:list'),
    get: (id: string) => ipcRenderer.invoke('tools:get', id),
    create: (tool: {
      id: string;
      name: string;
      description: string;
      parameters: string;
      code: string;
    }) => ipcRenderer.invoke('tools:create', tool),
    delete: (id: string) => ipcRenderer.invoke('tools:delete', id)
  },

  // Command Bar
  commandBar: {
    hide: () => ipcRenderer.send('command-bar:hide'),
    resize: (height: number) => ipcRenderer.send('command-bar:resize', height),
    onFocus: (callback: () => void) => {
      ipcRenderer.on('command-bar:focus', () => callback());
    }
  },

  // Inline Command Bar
  inlineBar: {
    hide: () => ipcRenderer.send('inline-bar:hide'),
    submit: (query: string, contextText: string) => ipcRenderer.invoke('inline-bar:submit', query, contextText),
    onFocus: (callback: () => void) => {
      ipcRenderer.on('inline-bar:focus', () => callback());
    },
    onContext: (callback: (context: string) => void) => {
      ipcRenderer.on('inline-bar:context', (_event, context) => callback(context));
    },
    onStatus: (callback: (status: string) => void) => {
      ipcRenderer.on('inline-bar:status', (_event, status) => callback(status));
    },
    onResponse: (callback: (response: string) => void) => {
      ipcRenderer.on('inline-bar:response', (_event, response) => callback(response));
    },
    onEditApplied: (callback: () => void) => {
      ipcRenderer.on('inline-bar:edit-applied', () => callback());
    }
  }
});

// Type definitions for the exposed API
export interface FariaAPI {
  agent: {
    submit: (query: string) => Promise<{ success: boolean; result?: string; error?: string }>;
    cancel: () => Promise<{ success: boolean }>;
    onStatus: (callback: (status: string) => void) => void;
    onResponse: (callback: (response: string) => void) => void;
  };
  state: {
    extract: () => Promise<{ success: boolean; state?: unknown; error?: string }>;
  };
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<{ success: boolean }>;
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
  tools: {
    list: () => Promise<Array<{
      id: string;
      name: string;
      description: string;
      parameters: string;
      code: string;
      created_at: string;
      usage_count: number;
    }>>;
    get: (id: string) => Promise<{
      id: string;
      name: string;
      description: string;
      parameters: string;
      code: string;
      created_at: string;
      usage_count: number;
    } | null>;
    create: (tool: {
      id: string;
      name: string;
      description: string;
      parameters: string;
      code: string;
    }) => Promise<{ success: boolean }>;
    delete: (id: string) => Promise<{ success: boolean }>;
  };
  commandBar: {
    hide: () => void;
    resize: (height: number) => void;
    onFocus: (callback: () => void) => void;
  };
  inlineBar: {
    hide: () => void;
    submit: (query: string, contextText: string) => Promise<{ success: boolean; result?: string; error?: string }>;
    onFocus: (callback: () => void) => void;
    onContext: (callback: (context: string) => void) => void;
    onStatus: (callback: (status: string) => void) => void;
    onResponse: (callback: (response: string) => void) => void;
    onEditApplied: (callback: () => void) => void;
  };
}

declare global {
  interface Window {
    faria: FariaAPI;
  }
}

