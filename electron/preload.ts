import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('faria', {
  // Agent
  agent: {
    submit: (query: string) => ipcRenderer.invoke('agent:submit', query),
    cancel: (source?: string) => ipcRenderer.invoke('agent:cancel', source || 'unknown'),
    authCompleted: () => ipcRenderer.send('agent:auth-completed'),
    onStatus: (callback: (status: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: string) => callback(status);
      ipcRenderer.on('agent:status', handler);
      return () => ipcRenderer.removeListener('agent:status', handler);
    },
    onResponse: (callback: (response: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, response: string) => callback(response);
      ipcRenderer.on('agent:response', handler);
      return () => ipcRenderer.removeListener('agent:response', handler);
    },
    onChunk: (callback: (chunk: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, chunk: string) => callback(chunk);
      ipcRenderer.on('agent:chunk', handler);
      return () => ipcRenderer.removeListener('agent:chunk', handler);
    },
    onAuthRequired: (callback: (data: { toolkit: string; redirectUrl: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { toolkit: string; redirectUrl: string }) => callback(data);
      ipcRenderer.on('agent:auth-required', handler);
      return () => ipcRenderer.removeListener('agent:auth-required', handler);
    },
    onToolApprovalRequired: (callback: (data: { toolName: string; toolDescription: string; args: Record<string, unknown>; isComposio: boolean; displayName?: string; details?: Record<string, string> }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { toolName: string; toolDescription: string; args: Record<string, unknown>; isComposio: boolean; displayName?: string; details?: Record<string, string> }) => callback(data);
      ipcRenderer.on('agent:tool-approval-required', handler);
      return () => ipcRenderer.removeListener('agent:tool-approval-required', handler);
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
    getThemeData: () => ipcRenderer.invoke('settings:getThemeData') as Promise<{ theme: string; colors: { background: string; text: string; accent: string }; font: string }>,
    onThemeChange: (callback: (themeData: { theme: string; colors: { background: string; text: string; accent: string }; font: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, themeData: { theme: string; colors: { background: string; text: string; accent: string }; font: string }) => callback(themeData);
      ipcRenderer.on('settings:theme-change', handler);
      return () => ipcRenderer.removeListener('settings:theme-change', handler);
    },
    notifyOpacityChange: (opacity: number) => ipcRenderer.send('settings:opacity-change', opacity),
    onOpacityChange: (callback: (opacity: number) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, opacity: number) => callback(opacity);
      ipcRenderer.on('settings:opacity-change', handler);
      return () => ipcRenderer.removeListener('settings:opacity-change', handler);
    },
    getSizeMode: () => ipcRenderer.invoke('settings:getSizeMode') as Promise<string>,
    onSizeChange: (callback: (size: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, size: string) => callback(size);
      ipcRenderer.on('settings:size-change', handler);
      return () => ipcRenderer.removeListener('settings:size-change', handler);
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

  // Onboarding
  onboarding: {
    checkAccessibility: () => ipcRenderer.invoke('onboarding:checkAccessibility'),
    checkScreenRecording: () => ipcRenderer.invoke('onboarding:checkScreenRecording'),
    requestAccessibility: () => ipcRenderer.invoke('onboarding:requestAccessibility'),
    openAccessibilitySettings: () => ipcRenderer.invoke('onboarding:openAccessibilitySettings'),
    openScreenRecordingSettings: () => ipcRenderer.invoke('onboarding:openScreenRecordingSettings'),
    onCommandBarOpened: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('onboarding:command-bar-opened', handler);
      return () => ipcRenderer.removeListener('onboarding:command-bar-opened', handler);
    },
    onQuerySubmitted: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('onboarding:query-submitted', handler);
      return () => ipcRenderer.removeListener('onboarding:query-submitted', handler);
    },
    demoSubmit: () => ipcRenderer.send('onboarding:demo-submit'),
  },

  // Command Bar
  commandBar: {
    hide: () => ipcRenderer.send('command-bar:hide'),
    resize: (height: number, agentAreaHeight?: number) => ipcRenderer.send('command-bar:resize', height, agentAreaHeight ?? 0),
    setDropdownVisible: (visible: boolean) => ipcRenderer.send('command-bar:dropdown-visible', visible),
    refreshSelection: () => ipcRenderer.invoke('command-bar:refresh-selection') as Promise<{ hasSelectedText: boolean; selectedTextLength: number }>,
    onFocus: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('command-bar:focus', handler);
      return () => ipcRenderer.removeListener('command-bar:focus', handler);
    },
    onDetecting: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('command-bar:detecting', handler);
      return () => ipcRenderer.removeListener('command-bar:detecting', handler);
    },
    onReady: (callback: (data: { hasSelectedText: boolean; selectedTextLength: number }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { hasSelectedText: boolean; selectedTextLength: number }) => callback(data);
      ipcRenderer.on('command-bar:ready', handler);
      return () => ipcRenderer.removeListener('command-bar:ready', handler);
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
      ipcRenderer.on('command-bar:error', handler);
      return () => ipcRenderer.removeListener('command-bar:error', handler);
    },
    onWillHide: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('command-bar:will-hide', handler);
      return () => ipcRenderer.removeListener('command-bar:will-hide', handler);
    },
    onReset: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on('command-bar:reset', handler);
      return () => ipcRenderer.removeListener('command-bar:reset', handler);
    },
    onSetQuery: (callback: (query: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, query: string) => callback(query);
      ipcRenderer.on('command-bar:set-query', handler);
      return () => ipcRenderer.removeListener('command-bar:set-query', handler);
    }
  }
});

// Type definitions for the exposed API
export interface FariaAPI {
  agent: {
    submit: (query: string) => Promise<{ success: boolean; result?: string; error?: string }>;
    cancel: (source?: string) => Promise<{ success: boolean }>;
    authCompleted: () => void;
    onStatus: (callback: (status: string) => void) => () => void;
    onResponse: (callback: (response: string) => void) => () => void;
    onChunk: (callback: (chunk: string) => void) => () => void;
    onAuthRequired: (callback: (data: { toolkit: string; redirectUrl: string }) => void) => () => void;
    onToolApprovalRequired: (callback: (data: { toolName: string; toolDescription: string; args: Record<string, unknown>; isComposio: boolean; displayName?: string; details?: Record<string, string> }) => void) => () => void;
    toolApprovalResponse: (approved: boolean) => void;
  };
  state: {
    extract: () => Promise<{ success: boolean; state?: unknown; error?: string }>;
  };
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<{ success: boolean }>;
    getDefaultPrompt: () => Promise<string>;
    getThemeData: () => Promise<{ theme: string; colors: { background: string; text: string; accent: string }; font: string }>;
    onThemeChange: (callback: (themeData: { theme: string; colors: { background: string; text: string; accent: string }; font: string }) => void) => () => void;
    notifyOpacityChange: (opacity: number) => void;
    onOpacityChange: (callback: (opacity: number) => void) => () => void;
    getSizeMode: () => Promise<string>;
    onSizeChange: (callback: (size: string) => void) => () => void;
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
  onboarding: {
    checkAccessibility: () => Promise<boolean>;
    checkScreenRecording: () => Promise<'granted' | 'denied' | 'not-determined'>;
    requestAccessibility: () => Promise<void>;
    openAccessibilitySettings: () => Promise<void>;
    openScreenRecordingSettings: () => Promise<void>;
    onCommandBarOpened: (callback: () => void) => () => void;
    onQuerySubmitted: (callback: () => void) => () => void;
    demoSubmit: () => void;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  commandBar: {
    hide: () => void;
    resize: (height: number, agentAreaHeight?: number) => void;
    setDropdownVisible: (visible: boolean) => void;
    refreshSelection: () => Promise<{ hasSelectedText: boolean; selectedTextLength: number }>;
    onFocus: (callback: () => void) => () => void;
    onDetecting: (callback: () => void) => () => void;
    onReady: (callback: (data: { hasSelectedText: boolean; selectedTextLength: number }) => void) => () => void;
    onError: (callback: (error: string) => void) => () => void;
    onWillHide: (callback: () => void) => () => void;
    onReset: (callback: () => void) => () => void;
    onSetQuery: (callback: (query: string) => void) => () => void;
  };
}

declare global {
  interface Window {
    faria: FariaAPI;
  }
}
