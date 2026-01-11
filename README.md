# Faria

> The copilot for work on a computer.

Faria is an AI-powered desktop assistant that helps you accomplish tasks across any application on your Mac. Press `Cmd+Shift+Space` to invoke Faria and describe what you want to do.

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
- Anthropic API key

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Download cliclick (for input automation):
   ```bash
   brew install cliclick
   # Or download from https://github.com/BlueM/cliclick/releases
   # and place in resources/cliclick
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. In a new terminal, start Electron:
   ```bash
   npm run electron:dev
   ```

5. On first launch:
   - Go to Settings
   - Enter your Anthropic API key
   - Grant Accessibility permissions when prompted

## Usage

1. Press `Cmd+Shift+Space` to open the command bar
2. Type your request (e.g., "Replace all instances of 'foo' with 'bar'")
3. Faria will take action and show the result
4. Press `Cmd+Shift+Space` again to dismiss

## Keyboard Shortcuts

- `Cmd+Shift+Space` - Toggle command bar
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
npm run build
```

The built app will be in `dist/`.

## License

MIT

