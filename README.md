<div align="center">

# dlient

**A local-first, plugin-based desktop host for AI agents.**

```
Electron Host · Node plugin workers · React plugin UI · Local import · No server
```

> **English** · [简体中文](README.zh-CN.md)

</div>

---

## Table of Contents

- [What is it](#what-is-it)
- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Plugin Development](#plugin-development)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## What is it

`dlient` is a desktop host for AI-agent tools. The host itself only does three things: **install plugins, run them, and connect them together**. A plugin is one `.dlient` package that may contain two halves:

- a **worker** — a Node process run inside the host's worker pool (no DOM, no renderer);
- a **UI** — a React bundle loaded into the host renderer as a `SystemJS` `remoteEntry`.

Because everything is a plugin, you decide what runs where. There is no account, no telemetry server, and no storefront — plugins are distributed as `.dlient` packages and imported locally.

- **Plugin-first** — capabilities come entirely from plugins.
- **No cloud required** — data lives under `~/.dlient-open`.
- **Deep install** — a plugin can declare `preInstall` dependencies resolved automatically from npm, a GitHub Release, or a direct `.dlient` URL.
- **Local integrity** — every installed package is signed locally and re-verified when it boots or loads its UI, so a corrupted package is refused instead of misbehaving.

---

## Features

| Area | Details |
| --- | --- |
| Plugin runtime | Node worker pool + React UI with keep-alive pages |
| Permission model | Method-level `manifest.permissions`, resource path checks, UI whitelist |
| Built-in runtime | `nodejs.*` host-api (probe / resolve / install a bundled Node.js LTS) — no plugin required |
| Deep install | `preInstall`: npm semver · GitHub latest-Release `.dlient` asset · direct URL |
| Integrity | Local Ed25519 `signature.json` written on install, verified at startup and at protocol load |
| Local-first | Settings, plugins and logs under `~/.dlient-open` |

Example data flow:

```
 .dlient ──► import ──► unpack → patch manifest (source=local, system=false)
                │
                ├─► preInstall deps: npm / GitHub Release / URL  (recursive, dedup)
                │
                └─► write local signature.json (package.json + dist/**)
                ▼
   run: worker (Node pool)  ·  UI (React in host)  ·  host-api calls checked against permissions
```

---

## Architecture

```
dlient-open/
├─ app/                 Electron host (main / preload / renderer)
│  ├─ packages/         @dlient-open npm packages (source-linked)
│  │   ├─ core/         pool / controller / protocol
│  │   ├─ create-plugin/   scaffolding package (template in templates/plugin-demo)
│  │   ├─ plugin-sdk/   createWorkerRpc, host-api typing, vite helpers
│  │   ├─ api-types/    single source of host-api signatures (HostApiMap)
│  │   ├─ api-bridge/   UI ⇄ worker bridge
│  │   ├─ ui/           shared React components (Webview, PluginView, …)
│  │   ├─ i18n/         locale provider + bundles
│  │   └─ native-host-sdk/   JSON-RPC client/server for native modules
│  └─ src/main/         api tables, org (sign/verify), host-shell, runtime, …
├─ plugins/
│  └─ dsh/              sample plugin (DeepSeek Harness web UI)
└─ skills/              plugin-development skills (English + 简体中文)
```

- **Main process**: windows, the `dlientOpen://` protocol, plugin registry, host-api executor, permission checks, local signing and verification.
- **Worker**: one Node process per plugin (solo or shared pool). Privileged operations never touch the OS directly — they go through host-api, which the main process validates.
- **UI**: React rendered by the host; plugin bundles are loaded by SystemJS and share `@dlient-open/ui` / `@dlient-open/i18n`.
- **Built-in pages**: Console（操作台）and Settings are part of the host (`layout` / `setting` / `nodejs`), not plugins.

---

## Quick Start

### 1. Run the host from source

```bash
git clone <this-repo> dlient-open
cd dlient-open/app
npm install
npm run dev
```

> [!NOTE]
> Data lives under `~/.dlient-open` (Windows: `%USERPROFILE%\.dlient-open`).

### 2. Install a plugin (≤ 60 seconds)

1. Click **导入插件 (Import plugin)** in the Console header.
2. Pick a `.dlient` package and confirm the import.
3. The plugin is installed locally and opens.

### 3. Try the sample plugin

```bash
cd dlient-open/plugins/dsh
npm install
npm run pack         # produces dsh-0.1.0.dlient
```

Then import that file in the host. `dsh` needs Node.js ≥ 22 — the host resolves a runtime automatically (bundled LTS or your local `node`).

### Documentation

- Plugin manifest, host-api and permission model: `skills/` (`dlient-plugin-dev` English, `dlient-plugin-dev-cn` 简体中文).
- Scaffolding: `npx @dlient-open/create-plugin my-plugin` (see `app/packages/create-plugin/README.md`).

---

## Plugin Development

A plugin is a `package.json` with a `dlient` manifest, plus an optional worker (`src/main`) and/or UI (`src/renderer`).

```jsonc
{
  "name": "my-plugin",
  "dlient": {
    "id": "my-plugin",
    "name": "My Plugin",
    "version": "0.1.0",
    "type": "app",                 // app | full | worker | ui
    "icon": "assets/icon.svg",
    "permissions": ["child.spawn", "net.getFreePort", "log.write"],
    "nodeVersion": "22",
    "preInstall": {                // deep install dependencies (optional)
      "helper-a": "0.5.1",
      "helper-b": "https://github.com/owner/helper-b",
      "helper-c": "https://example.com/helper-c.dlient"
    }
  }
}
```

- **Worker**: `import { createWorkerRpc } from '@dlient-open/plugin-sdk'`; talk to the host with `rpc.fs.* / rpc.child.* / rpc.nodejs.* / rpc.plugin.*`…
- **UI**: build with React + `@dlient-open/ui`; embed external pages with the `Webview` component.
- **Pack**: `npm run pack` (uses `script/make-dlient.mjs` inside the plugin) → `.dlient`; the host signs it locally on import.

---

## Roadmap

- [x] Local plugin import / uninstall and registry
- [x] Built-in `nodejs.*` runtime host-api
- [x] `preInstall` deep install (npm / GitHub Release / direct URL)
- [x] Local integrity signing, verified at boot and at protocol load
- [x] Plugin development skills (English + 简体中文)
- [ ] Prebuilt installers for Windows / macOS / Linux
- [ ] More plugin templates and sample plugins
- [ ] Automated tests and CI for the host and plugins
- [ ] Visual documentation and screenshots in `docs/`

---

## Contributing

Bug reports and feature requests: open an issue and include steps to reproduce. Host logs live under `~/.dlient-open/plugin-data/<pluginId>/logs/`.

Code contributions are welcome:

1. Fork and clone the repo; develop the host under `app/`, plugins under `plugins/`.
2. Run `npm run build` in the host and `npm run build` in any changed plugin before finishing (source ↔ dist must stay in sync).
3. Open a pull request and describe what changed and why.

Full details: `CONTRIBUTING.md` (planned).

---

## License

[MIT](LICENSE) © 2026 dlient contributors
