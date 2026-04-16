# Faria

> The copilot for work on a computer.

Faria is an AI-powered desktop assistant that helps you accomplish tasks across any application on your Mac. Press `Cmd+/` to invoke Faria and describe what you want to do.

## Features

- **Universal Access**: Works with any application - browsers, Office apps, creative tools, and more
- **Intelligent State Extraction**: Uses tiered approach (JS injection → AppleScript → Accessibility → Screenshot) to understand your current context
- **Natural Actions**: Click, type, scroll, and execute scripts through natural language
- **App Scripting**: Execute Python in Blender, JavaScript in Photoshop, AppleScript in Office apps
- **Learning**: Creates custom tools to optimize workflows over time
- **Memory**: Persistent context across sessions via Letta

## Prerequisites

- macOS 12.0 or later
- Node.js 18+
- An LLM API key (Anthropic, OpenAI, or Google)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the environment template and fill in your keys:
   ```bash
   cp .env.example .env
   ```
   At minimum you need one LLM key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GOOGLE_API_KEY`). See `.env.example` for all options.

3. Build the native addon:
   ```bash
   npm run build:native
   ```

4. Download cliclick (for input automation):
   ```bash
   brew install cliclick
   # Or download from https://github.com/BlueM/cliclick/releases
   # and place in resources/cliclick
   ```

5. Start the app:
   ```bash
   npm run dev
   ```

6. On first launch:
   - Go to Settings
   - Enter your API key if not set via `.env`
   - Grant Accessibility permissions when prompted

## Proxy (optional)

The `faria-proxy/` directory contains a Cloudflare Worker that proxies LLM and tool requests for authenticated users. This is only needed if you want to run Faria without distributing API keys to end users.

To self-host the proxy:
```bash
cd faria-proxy
npm install
npx wrangler secret put ANTHROPIC_API_KEY   # repeat for other providers
npx wrangler deploy
```

Then set `FARIA_PROXY_BASE=https://your-worker.workers.dev` in your `.env`.

## Usage

1. Press `Cmd+/` to open the command bar
2. Type your request (e.g., "Replace all instances of 'foo' with 'bar'")
3. Faria will take action and show the result
4. Press `Cmd+/` again to dismiss

## Keyboard Shortcuts

- `Cmd+/` - Toggle command bar
- `Cmd+Shift+/` - Switch between Agent and Inline mode
- `Enter` - Submit query
- `Escape` - Dismiss command bar

## Architecture

```
faria/
├── electron/           # Main process code
│   ├── main.ts        # Electron entry point
│   ├── preload.ts     # IPC bridge
│   ├── services/      # State extraction, automation
│   ├── agent/         # Agent loop, tools
│   └── db/            # SQLite storage
├── src/               # Renderer (React)
│   ├── components/    # UI components
│   └── styles/        # CSS themes
└── resources/         # Bundled binaries
```

## Themes

Faria includes three built-in themes:
- **Default** - Shadow grey with almond cream text
- **Midnight** - GitHub dark inspired
- **Forest** - Nature tones

Custom themes can be created in Settings.

## Building

```bash
npm run build:native   # compile the Swift/node-gyp native addon
npm run build          # bundle renderer + main process
```

The built app will be in `dist/`.

## Releasing

Faria release artifacts are signed and notarized locally on macOS, then uploaded to GitHub Releases.

```bash
RELEASE_TAG=v1.0.0-beta.2 npm run release:local
```

The command validates the stapled `dist/Faria.dmg`, verifies the notarized app, and uploads the DMG to the chosen GitHub release tag.

## License

MIT
