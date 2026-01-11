import { FariaAPI } from '../../electron/preload';

declare global {
  interface Window {
    faria: FariaAPI;
  }
}

export {};

