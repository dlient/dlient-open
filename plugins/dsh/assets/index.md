# dsh (DeepSeek Harness)

## 1. Introduction

dsh runs the **DeepSeek Harness (dsh)** AI Agent Web UI inside dlient (`type: 'app'`).

- **Worker**: detects / installs Node.js (via the `nodejs` plugin) → `npm install -g @deepseek-ai/dsh` → starts `dsh web --no-open` (default `http://127.0.0.1:3080`), probes port readiness and hands the URL to the renderer.
- **Renderer**: embeds the DSH web page with the `Webview` component from `@dlient-open/ui` (forwarded to a main-process WebContentsView via the worker's built-in `webview:*` bridge).

```
DSH (app) ─ worker: Node.js → npm i -g @deepseek-ai/dsh → dsh web --no-open
DSH (renderer) ─ <Webview src=http://127.0.0.1:3080>
```

## 2. Exported Methods

| Method | Description |
|--------|-------------|
| `dsh.start` | Ensure Node.js + DSH, start the `dsh web` service and return the URL |
| `dsh.stop` | Stop the running `dsh web` service (and clean up the PID file / port) |
| `dsh.status` | Query the service status (running / url) |

Key method signatures:

```ts
const { url } = await rpc.plugin.invoke('dsh', 'dsh.start')
const status = await rpc.plugin.invoke('dsh', 'dsh.status')
await rpc.plugin.invoke('dsh', 'dsh.stop')
```

## 3. Skills

See [skills/SKILL.md](skills/SKILL.md) for the AI Agent skill provided by this plugin.

## Dependencies

- `nodejs` (system plugin): `nodejs.checkLocal` / `nodejs.checkBundled` / `nodejs.install`.
- Host UI `@dlient-open/ui`: `Webview` component (requires `webview.create` / `webview.navigate` permissions).
