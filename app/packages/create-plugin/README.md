# @dlient-open/create-plugin

Scaffold for **dlient** plugins. One command creates a plugin project that builds into a `.dlient` package and imports into the open-source dlient host.

> **English** · [简体中文](README.zh-CN.md)

## Quick start

```bash
npx @dlient-open/create-plugin my-plugin          # default mode: UI only (no worker)

cd my-plugin
npm install          # the scaffold does NOT install or init git for you
npm run dev          # watch build while developing
npm run build        # build UI (remoteEntry)
npm run pack         # → my-plugin-0.1.0.dlient
```

Then open **dlient** → **Import plugin** → pick the generated `.dlient`.

## Usage

```
npx @dlient-open/create-plugin <plugin-id> [options]
```

`<plugin-id>` must be lowercase letters / digits / hyphens and start with a letter (e.g. `my-plugin`).

| Option | Description |
|--------|-------------|
| `--name "<display name>"` | Plugin display name (defaults to the id) |
| `--dir <path>` | Directory to create the project in (defaults to the current directory) |
| `--worker` | **worker** mode: UI + worker (background RPC / subprocess work) |
| `--native-host` | **native-host** mode: UI + worker + native modules carried by an official-Node child (`dlient.nativeModules` + `@dlient-open/native-host-sdk`) — no rebuild needed |
| `--native` | **native** mode: UI + worker + vendored prebuilds via `@electron/rebuild` (built per platform) |

No mode flag means **default** mode: a UI-only plugin — no worker, no `skills/`, no `build:worker`. Mode flags are mutually exclusive (one template per project).

`--skip-install` and `--no-git` are accepted for compatibility and do nothing — this CLI never installs dependencies or initializes a repository.

## What you get

All four modes share the same base; the mode adds files on top:

```
my-plugin/
├─ .agent/                Development docs for AI coding assistants (English; shared by all modes)
├─ assets/                icon.svg · index.md / index.en-US.md / index.zh-CN.md (user-facing docs) · mcp.json
├─ src/renderer/App.tsx   UI (React + Vite) → dist/remoteEntry.js
├─ script/                build-clean.mjs · make-dlient.mjs
└─ package.json           dlient manifest (`dlient` object) + scripts
```

| Mode | Files added on top of the base |
|------|-------------------------------|
| `default` | — |
| `worker` | `src/main/index.ts` (worker), `script/build-worker.mjs`, `skills/SKILL.md` |
| `native-host` | the worker files + `src/native-host/index.ts`, `dlient.nativeModules`, `@dlient-open/native-host-sdk` |
| `native` | the worker files + `script/build-native.mjs`, `dlient.native: true`, `@electron/rebuild`, `npm run build:native` |

Notes:

- `assets/index.md` / `index.en-US.md` are generated from the project `README.md`; `assets/index.zh-CN.md` from `README.cn.md`. They are what users see on the plugin's detail page.
- `.agent/` holds the plugin-development documentation (host-api, manifest schema, UI kit, worker model, the three mode-switch guides, and copy-ready sources under `example/`). It is generated from the `dlient-plugin-dev` skill and shared by all four templates. Point your AI assistant at it — `AGENTS.md` explains how and states this project's current mode.
- The generated `package.json` already declares `files: ["dist", "assets", "script", "*.dlient"]` and `prepublishOnly: "npm run pack"`, so publishing always ships a fresh `.dlient`.
- A plugin only ships `skills/SKILL.md` when it builds a worker (`dist/worker.js`), and only a plugin that ships a worker can expose methods to other plugins (the manifest `type` does not matter). Staying UI-only is the cheapest option — switch modes only when you actually need background logic (`.agent/references/mode-switch-*.md`).

## Publishing

- **Local distribution** — `npm run pack` writes `<id>-<version>.dlient` next to the project. The open-source host does not verify signatures, so the package imports as-is.
- **npm** — bump `version`, then `npm publish`. Two conventions matter:
  - `keywords` **must include `dlient-open-plugin`** — this keyword is reserved for plugin packages (the plugin marketplace searches by it), and must not be used by non-plugin packages.
  - keep the `.dlient` inside the published package (the `files` field already does) — the host installs from the `.dlient` contained in the npm tarball.

## Requirements

Node.js ≥ 18 (npm ships with it). Nothing needs to be installed globally.

## Development

Templates live in `templates/{default,worker,native-host,native}/` — four pre-trimmed templates — plus `templates/_shared/.agent/`, the single documentation copy shared by all of them (generated from `skills/dlient-plugin-dev`, so it never drifts).

```bash
npm run prepare:templates   # sync _shared/.agent from skills/ + check the 4 templates
npm run pack                # npm pack (tarball for local inspection)
```

To verify a change, run the CLI from this directory and inspect the generated project:

```bash
node bin/cli.mjs demo-plugin --dir <tmp>                  # default (UI only)
node bin/cli.mjs demo-plugin --worker --dir <tmp>         # worker
node bin/cli.mjs demo-plugin --native-host --dir <tmp>    # native-host
node bin/cli.mjs demo-plugin --native --dir <tmp>         # native (vendored prebuilds)
```
