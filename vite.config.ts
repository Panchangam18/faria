import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

export default defineConfig({
  optimizeDeps: {
    // Prevent Vite's esbuild pre-bundler from processing Electron's runtime
    // module. The npm `electron` package just returns a binary path string —
    // the real APIs are injected by the Electron runtime. Pre-bundling it
    // breaks require("electron") in the main process.
    exclude: ['electron'],
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'better-sqlite3',
                'node-llama-cpp',
                '@langchain/core',
                '@langchain/anthropic',
                'langsmith',
                'dotenv',
                '@anthropic-ai/sdk',
              ]
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]),
    renderer()
  ],
  server: {
    port: 5174,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@electron': resolve(__dirname, 'electron')
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        commandBar: resolve(__dirname, 'command-bar.html')
      }
    }
  }
});