# AGENTS.md

This project is a **dlient plugin** (`__PLUGIN_ID__` — "__PLUGIN_NAME__"), scaffolded by
`@dlient-open/create-plugin`. dlient is an Electron desktop host that loads plugins; a plugin may have a
**worker** (Node, runs in an Electron `utilityProcess`) and/or a **UI** (React bundle loaded by the host
renderer). Workers are sandboxed: every file / process / network operation goes through **host-api** calls
validated by the main process.

## Current mode: `default` — UI only (no worker)

This project was scaffolded with the **default** template, i.e. the pure-UI mode:

| Aspect | In this project |
| --- | --- |
| Entry | `src/renderer/App.tsx` → `dist/remoteEntry.js` (SystemJS) only |
| Worker | **none** — no `src/main/`, no `dist/worker.js`, no `build:worker` script |
| Host capabilities | called **directly from the UI** via `api.*` (UI host-api whitelist, see `.agent/references/ui-api.md`) |
| `dlient.expose` | **absent** — exposing methods requires a worker (`dist/worker.js`), and this mode has none |
| `skills/` | **absent** — the agent skill is only shipped when the plugin actually ships a worker |

Keep it this way unless you actually need background logic: every added process is extra surface to sandbox,
authorize and clean up.

## Switching mode

Three modes can be added on top of a UI-only plugin. Each has a step-by-step guide (scripts, manifest fields,
dependencies) and ready-to-copy sources under `.agent/example/`:

| Target mode | Scaffold a new project | Convert this project | Guide |
| --- | --- | --- | --- |
| `worker` — background RPC / subprocess work | `npx @dlient-open/create-plugin <id> --worker` | copy `.agent/example/worker/` into `src/` and follow the guide | `.agent/references/mode-switch-worker.md` |
| `native-host` — native `.node` modules via an official-Node child (recommended) | `npx @dlient-open/create-plugin <id> --native-host` | copy `.agent/example/native-host/` into `src/` and follow the guide | `.agent/references/mode-switch-native-host.md` |
| `native` — vendored `.node` prebuilds + `@electron/rebuild` (per platform) | `npx @dlient-open/create-plugin <id> --native` | add the worker files + `script/build-native.mjs` and follow the guide | `.agent/references/mode-switch-native.md` |

Switching back (worker → UI only) means deleting `src/main/`, `dist/worker.js`, the `build:worker` /
`dev:watch:worker` scripts, `dlient.expose` and `skills/` — and re-checking that the UI no longer calls
`api.request(...)` (worker RPC).

## Read `.agent/` first

Before writing or changing code, read the docs under `.agent/`:

| File | Covers |
| --- | --- |
| `.agent/SKILL.md` | Plugin development guide — concepts, workflow, manifest, host-api, permissions |
| `.agent/references/create-plugin.md` | Scaffolding flags, template modes, dev workflow, packaging & import |
| `.agent/references/mode-switch-worker.md` | Converting this project to the `worker` mode |
| `.agent/references/mode-switch-native-host.md` | Converting this project to the `native-host` mode |
| `.agent/references/mode-switch-native.md` | Converting this project to the `native` (vendored prebuilds) mode |
| `.agent/references/manifest-schema.md` | Every `dlient.*` manifest field, with a commented example |
| `.agent/references/host-api-reference.md` | Per-method host-api docs (params, types, examples) |
| `.agent/references/permission-model.md` | Sandbox bans, resource grants, unified confirm dialogs, secret storage |
| `.agent/references/worker.md` | Worker: SDK API, RPC, logging, `expose` + `grant`, subprocess handles |
| `.agent/references/ui.md`, `ui-api.md` | UI: `@dlient-open/ui` components, hooks, i18n, theming, UI host-api whitelist |
| `.agent/references/native-host.md` | Native modules via a dedicated full-permission Node child |
| `.agent/references/dev-standards.md` | Worker + UI coding standards |
| `.agent/example/worker/`, `.agent/example/native-host/` | Copy-ready sources for the two upgrade paths |

## Layout

| Path | Purpose |
| --- | --- |
| `src/renderer/App.tsx` | UI entry — built to `dist/remoteEntry.js` (SystemJS) |
| `package.json` → `dlient` | The plugin manifest (never a separate `plugin.json`) |
| `script/` | Build scripts (`build-clean.mjs`, `make-dlient.mjs`) |

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Watch build: UI (`vite build --watch`) |
| `npm run build` | One-off build → `dist/remoteEntry.js` + CSS/assets |
| `npm run pack` | Produce a distributable `.dlient` package |

## Ground rules

- Declare **every** host-api call in `dlient.permissions` (e.g. `log`, `app.data`); resource access
  additionally needs `fsDirs` / `spawnCmds`, or a runtime grant.
- UI must use `@dlient-open/ui` components and support light/dark themes + i18n (`src/renderer/i18n.ts`).
- Never store passwords / keys / tokens in plain text — encrypt them through the host
  (`api.crypt.encrypt` / `api.crypt.decrypt`, permission `app.crypt`).
- Do not add `dlient.expose` entries: exposing requires a worker (`dist/worker.js`), and most plugins should
  not expose anything at all. See `.agent/references/worker.md` if you do need it (including the optional
  `grant` handler).
