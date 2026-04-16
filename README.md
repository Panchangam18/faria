<div align="center">
  <img src="build/icon-source.svg" width="80" />
  <h1>Faria</h1>
  <p>An AI agent that lives on your Mac and works across any app.</p>
  <a href="https://faria.computer">faria.computer</a>
</div>

---

Faria is a macOS desktop agent that understands your screen and takes action. Press a shortcut to open it, describe what you want, and it handles the rest — clicking, typing, running commands, searching the web, editing files, or calling any tool in your workflow.

## Models

| Provider | Models |
|----------|--------|
| Anthropic | Claude Opus 4.6, Claude Sonnet 4.6 |
| Google | Gemini 3.1 Pro, Gemini 3.1 Flash Lite |
| OpenAI | GPT-5.4, computer-use |

Switch models at any time from Settings. Bring your own API key or sign in to use the managed proxy.

## How it works

When you invoke Faria, it extracts the state of your focused app through a tiered approach — JavaScript injection, AppleScript, the macOS Accessibility API, and screenshots as a fallback. The agent then plans and executes actions using a set of built-in tools:

- **Computer actions** — click, type, scroll, drag, key combos via the Accessibility API
- **Bash** — run shell commands
- **Web search** — Serper-powered search with structured results
- **File tools** — read, write, and edit files
- **Replace selected text** — in-place text substitution in any app
- **Memory** — persistent vector memory across sessions; the agent recalls relevant context automatically
- **Composio** — 100+ app integrations (GitHub, Notion, Gmail, Slack, etc.)

## Shortcuts

| Action | Default | Customizable |
|--------|---------|-------------|
| Open / close | `Cmd+Enter` | Yes |
| Reset session | `Cmd+Shift+Enter` | Yes |
| Move window | `Cmd+Ctrl` + arrow keys | Yes |

All shortcuts can be remapped in Settings → Shortcuts.

## Themes

Five built-in themes: **Chateau**, **Comte**, **Mercédès**, **Pistols**, **Carnival** — plus a full custom color editor in Settings.

## Development setup

**Prerequisites:** macOS 12+, Node.js 18+

```bash
git clone https://github.com/Panchangam18/faria.git
cd faria

npm install

# Build the native macOS accessibility addon
npm run build:native

# Copy env template and add your API key(s)
cp .env.example .env

# Install cliclick for mouse/keyboard automation
brew install cliclick

npm run dev
```

On first launch, go to Settings and enter at least one LLM API key if you haven't set it in `.env`. Grant Accessibility permissions when prompted.

## Self-hosting the proxy

The `faria-proxy/` directory is a Cloudflare Worker that proxies LLM and tool requests for signed-in users. You only need this if you want to run your own managed deployment (i.e. users sign in and don't bring their own keys).

```bash
cd faria-proxy
npm install

# Set provider keys as Worker secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GOOGLE_API_KEY
npx wrangler secret put SERPER_API_KEY

npx wrangler deploy
```

Then set `FARIA_PROXY_BASE=https://your-worker.workers.dev` in your `.env`.

## Building a release

```bash
npm run build:native   # compile native addon
npm run build          # bundle app
```

Output is in `dist/`. For a signed and notarized DMG, set the `APPLE_*` variables in `.env` and run:

```bash
RELEASE_TAG=v1.0.0 npm run release:local
```

## Architecture

```
faria/
├── electron/
│   ├── main.ts           # Electron entry, IPC, window management
│   ├── preload.ts        # Renderer ↔ main bridge
│   ├── agent/            # Agent loop, tools, memory flush, prompts
│   ├── services/         # State extraction, models, proxy, auth, memory
│   └── db/               # SQLite (settings, history, custom tools)
├── src/                  # React renderer (command bar, settings, chat UI)
├── native/               # Swift + node-gyp addon for window visibility
└── faria-proxy/          # Cloudflare Worker proxy
```

## License

MIT — see [LICENSE](LICENSE).
