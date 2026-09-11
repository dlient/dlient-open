# AGENTS.md

This project is a **dlient plugin** (`__PLUGIN_ID__` — "__PLUGIN_NAME__"), scaffolded by
`@dlient-open/create-plugin`. dlient is an Electron desktop host that loads plugins; a plugin may have a
**worker** (Node, runs in an Electron `utilityProcess`) and/or a **UI** (React bundle loaded by the host
renderer). Workers are sandboxed: every file / process / network operation goes through **host-api** calls
validated by the main process.

## Current mode: `native` (vendored prebuilds) — UI + worker + native modules

This project was scaffolded with the **native** template (the legacy native path):

| Aspect | In this project |
| --- | --- |
| Entry | UI `src/renderer/App.tsx` → `dist/remoteEntry.js`; worker `src/main/index.ts` → `dist/worker.js` |
| Native modules | `dlient.native: true` — `.node` prebuilds are **vendored into `dist/`** and must be rebuilt **per platform** via `@electron/rebuild` (`npm run build:native`) |
| Worker | runs in the host worker pool |
| Host capabilities | from the worker via `rpc.*`; a few from the UI via `api.*` (see `.agent/references/ui-api.md`) |
| `dlient.expose` | present (demo methods) — **only add entries you really want other plugins to call** |
| `skills/` | present — a plugin only ships an agent skill when it ships a worker (`dist/worker.js`) |

> This mode is set up by `.agent/references/mode-switch-native.md`. Prefer the **native-host** mode
> (`--native-host`, `dlient.nativeModules`) for new projects: it installs the native packages user-side and
> loads them in an official-Node child, so no per-platform rebuild is needed.
> Comparison: `.agent/references/native-host.md`.

## Switching mode

| Target mode | How | Guide |
| --- | --- | --- |
| `native-host` — recommended replacement for vendored prebuilds | add `src/native-host/` (`.agent/example/native-host/`), switch `dlient.native` → `dlient.nativeModules`, drop `@electron/rebuild` + `build:native` | `.agent/references/mode-switch-native-host.md` |
| `worker` — no native modules at all | delete `script/build-native.mjs`, `build:native`, `dlient.native` and the vendored prebuilds | `.agent/references/create-plugin.md` |
| `default` — pure UI, no worker | also delete `src/main/`, the `build:worker` / `dev:watch:worker` scripts, `dlient.expose` and `skills/` | `.agent/references/create-plugin.md` |

Scaffolding a new project in another mode:
`npx @dlient-open/create-plugin <id> --worker` / `--native-host` / (no flag for `default`).

## Read `.agent/` first

Before writing or changing code, read the docs under `.agent/`:

| File | Covers |
| --- | --- |
| `.agent/SKILL.md` | Plugin development guide — concepts, workflow, manifest, host-api, permissions |
| `.agent/references/create-plugin.md` | Scaffolding flags, template modes, dev workflow, packaging & import |
| `.agent/references/mode-switch-native.md` | How this mode is set up (vendored prebuilds + `@electron/rebuild`) |
| `.agent/references/mode-switch-worker.md` | Converting a UI-only project to the worker mode |
| `.agent/references/mode-switch-native-host.md` | Converting this project to the `native-host` mode |
| `.agent/references/native-host.md` | Native modules: both paths (`native` vs `nativeModules`), architecture, security |
| `.agent/references/manifest-schema.md` | Every `dlient.*` manifest field, with a commented example |
| `.agent/references/host-api-reference.md` | Per-method host-api docs (params, types, examples) |
| `.agent/references/permission-model.md` | Sandbox bans, resource grants, unified confirm dialogs, secret storage |
| `.agent/references/worker.md` | Worker: SDK API, RPC, logging, `expose` + `grant`, subprocess handles |
| `.agent/references/ui.md`, `ui-api.md` | UI: `@dlient-open/ui` components, hooks, i18n, theming, UI host-api whitelist |
| `.agent/references/dev-standards.md` | Worker + UI coding standards |
| `.agent/example/worker/`, `.agent/example/native-host/` | Copy-ready sources for the two upgrade paths |

## Layout

| Path | Purpose |
| --- | --- |
| `src/main/index.ts` | Worker entry — calls the host via `rpc.*` |
| `src/renderer/App.tsx` | UI entry — built to `dist/remoteEntry.js` (SystemJS) |
| `script/build-native.mjs` | Vendors + rebuilds the `.node` prebuilds (`npm run build:native`) |
| `package.json` → `dlient` | The plugin manifest (never a separate `plugin.json`) |
| `script/` | Build scripts (`build-worker.mjs`, `build-native.mjs`, `make-dlient.mjs`, …) |

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Watch build: UI (`vite build --watch`) + worker (`esbuild --watch`) |
| `npm run build` | One-off build → UI + worker + native prebuilds (`build:native`) |
| `npm run build:native` | Vendor + `@electron/rebuild` the native modules for the current platform |
| `npm run pack` | Produce a distributable `.dlient` package |

## Ground rules

- Declare **every** host-api call in `dlient.permissions` (e.g. `fs.read`, `child.spawn`, `app.getPath`);
  resource access additionally needs `fsDirs` / `spawnCmds`, or a runtime grant. Vendored native modules also
  require `dlient.platforms`.
- The worker is sandboxed (Node Permission Model): no direct `node:fs` / `node:child_process`, no sync
  blocking I/O, and **no `.node` addons**.
- UI must use `@dlient-open/ui` components and support light/dark themes + i18n (`src/renderer/i18n.ts`).
- Never store passwords / keys / tokens in plain text — encrypt them through the host
  (`rpc.app.crypt.encrypt` / `rpc.app.crypt.decrypt`, permission `app.crypt`).
- **Expose as little as possible.** Do not add `dlient.expose` entries unless another plugin must call them
  (or the user explicitly asks). Exposing requires a worker (`dist/worker.js`) — a UI-only plugin cannot
  serve such calls. If you do expose, prefer to also expose the `grant` handler (recommended, not required)
  and prefer returning `ask`; return `deny` for anything involving user privacy, passwords or keys. See
  `.agent/references/worker.md` § Exposing methods.
