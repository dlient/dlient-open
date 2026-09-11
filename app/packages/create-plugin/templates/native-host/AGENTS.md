# AGENTS.md

This project is a **dlient plugin** (`__PLUGIN_ID__` — "__PLUGIN_NAME__"), scaffolded by
`@dlient-open/create-plugin`. dlient is an Electron desktop host that loads plugins; a plugin may have a
**worker** (Node, runs in an Electron `utilityProcess`) and/or a **UI** (React bundle loaded by the host
renderer). Workers are sandboxed: every file / process / network operation goes through **host-api** calls
validated by the main process.

## Current mode: `native-host` — UI + worker + native modules

This project was scaffolded with the **native-host** template:

| Aspect | In this project |
| --- | --- |
| Entry | UI `src/renderer/App.tsx` → `dist/remoteEntry.js`; worker `src/main/index.ts` → `dist/worker.js`; native entry `src/native-host/index.ts` → `dist/native-host.js` |
| Native modules | `dlient.nativeModules` (installed user-side with npm, loaded by a dedicated **full-permission official-Node child**) — **no `@electron/rebuild`** |
| Worker | runs in the host worker pool; `npm run build` runs `build:worker` (which also emits `dist/native-host.js`) |
| Host capabilities | from the worker via `rpc.*`; a few from the UI via `api.*` (see `.agent/references/ui-api.md`) |
| `dlient.expose` | present (demo methods) — **only add entries you really want other plugins to call** |
| `skills/` | present — a plugin only ships an agent skill when it ships a worker (`dist/worker.js`) |

## Switching mode

| Target mode | How | Guide |
| --- | --- | --- |
| `worker` — drop native modules | delete `src/native-host/`, remove `dlient.nativeModules` + `@dlient-open/native-host-sdk` | `.agent/references/create-plugin.md` |
| `native` — switch to vendored prebuilds + `@electron/rebuild` | add `script/build-native.mjs` + `build:native`, swap `dlient.nativeModules` → `dlient.native: true` | `.agent/references/mode-switch-native.md` |
| `default` — pure UI, no worker | also delete `src/main/`, the `build:worker` / `dev:watch:worker` scripts, `dlient.expose` and `skills/` | `.agent/references/create-plugin.md` |

Scaffolding a new project in another mode:
`npx @dlient-open/create-plugin <id> --worker` / `--native` / (no flag for `default`).

> Choosing between the two native paths (`nativeModules` here vs vendored `native` + `@electron/rebuild`):
> `.agent/references/native-host.md` and `.agent/references/mode-switch-native.md`.

## Read `.agent/` first

Before writing or changing code, read the docs under `.agent/`:

| File | Covers |
| --- | --- |
| `.agent/SKILL.md` | Plugin development guide — concepts, workflow, manifest, host-api, permissions |
| `.agent/references/create-plugin.md` | Scaffolding flags, template modes, dev workflow, packaging & import |
| `.agent/references/mode-switch-worker.md` | Converting a UI-only project to the worker mode |
| `.agent/references/mode-switch-native-host.md` | Converting a project to this mode |
| `.agent/references/mode-switch-native.md` | Converting a project to the `native` (vendored prebuilds) mode |
| `.agent/references/native-host.md` | Native module architecture (native-host child, server/client, restart, security) |
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
| `src/native-host/index.ts` | Native-host entry — full-permission Node child that loads the `.node` modules |
| `src/renderer/App.tsx` | UI entry — built to `dist/remoteEntry.js` (SystemJS) |
| `package.json` → `dlient` | The plugin manifest (never a separate `plugin.json`) |
| `script/` | Build scripts (`build-worker.mjs`, `make-dlient.mjs`, …) |

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies (native modules go into `node_modules`) |
| `npm run dev` | Watch build: UI (`vite build --watch`) + worker + native-host (`esbuild --watch`) |
| `npm run build` | One-off build → `dist/remoteEntry.js` + `dist/worker.js` + `dist/native-host.js` |
| `npm run pack` | Produce a distributable `.dlient` package |

## Ground rules

- Declare **every** host-api call in `dlient.permissions` (e.g. `fs.read`, `child.spawn`, `app.getPath`);
  resource access additionally needs `fsDirs` / `spawnCmds`, or a runtime grant.
- The worker is sandboxed (Node Permission Model): no direct `node:fs` / `node:child_process`, no sync
  blocking I/O, and **no `.node` addons** — that is what the native-host child is for.
- UI must use `@dlient-open/ui` components and support light/dark themes + i18n (`src/renderer/i18n.ts`).
- Never store passwords / keys / tokens in plain text — encrypt them through the host
  (`rpc.app.crypt.encrypt` / `rpc.app.crypt.decrypt`, permission `app.crypt`).
- **Expose as little as possible.** Do not add `dlient.expose` entries unless another plugin must call them
  (or the user explicitly asks). Exposing requires a worker (`dist/worker.js`) — a UI-only plugin cannot
  serve such calls. If you do expose, prefer to also expose the `grant` handler (recommended, not required)
  and prefer returning `ask`; return `deny` for anything involving user privacy, passwords or keys. See
  `.agent/references/worker.md` § Exposing methods.
