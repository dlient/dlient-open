# Mode switch: UI-only (`default`) → worker (UI + worker)

This guide converts a **UI-only** plugin (scaffolded with no flag) into the **worker** mode: the UI
plus a worker that runs as a sandboxed Node process. It is the guide referenced by the
`default` and `native` templates from their `.agent/AGENTS.md`.

Ready-to-copy sources live in `.agent/example/worker/`.

## 1. When to choose this mode

Choose `worker` when the plugin needs work that does not belong in the renderer:

- RPC, long-running tasks, timers, background sync;
- file / network / subprocess access through host-api (`rpc.fs.*`, `rpc.net.*`, `rpc.child.*`);
- state that must survive a view reload (snapshot / restore);
- methods that **other plugins** call.

**Do not** add a worker when the UI alone is enough. A UI-only plugin is simpler and has less attack
surface — no extra process to sandbox, authorize and clean up. If the UI can call `api.*` directly,
stay `default`.

A UI-only plugin **must not** declare `dlient.expose`: there is no worker to serve the handler, so
cross-plugin calls fail with `WORKER_NOT_RUNNING` (`-2102`).

## 2. Files to add

Copy from `.agent/example/worker/`:

| Copy from `.agent/example/worker/` | To (project) | Notes |
| --- | --- | --- |
| `src/main/index.ts` | `src/main/index.ts` | Worker entry — `createWorkerRpc('<plugin-id>')`, one example handler + the `grant` handler |
| `build-worker.mjs` | `script/build-worker.mjs` | esbuild build → `dist/worker.js` (also emits `dist/native-host.js` if `src/native-host/` exists) |

The example uses the placeholder `__PLUGIN_ID__` — replace it with your plugin id (the scaffolder
already does this for generated projects).

Resulting layout (worker-specific files marked `+`):

```
my-plugin/
├── package.json
├── script/
│   ├── build-clean.mjs
│   ├── build-worker.mjs        # + added
│   └── make-dlient.mjs
├── skills/
│   └── SKILL.md                # + added (see §5)
├── src/
│   ├── main/
│   │   └── index.ts            # + added
│   └── renderer/               # UI (unchanged)
└── .agent/
```

## 3. `package.json` changes

### 3.1 `scripts`

Add `build:worker` and `dev:watch:worker`, append `build:worker` to the `build` chain, and (for the
combined `dev` watch) add `concurrently`:

```jsonc
"scripts": {
  "build": "node script/build-clean.mjs && npm run typecheck && npm run build:ui && npm run build:worker",
  "typecheck": "tsc --noEmit",
  "build:ui": "vite build",
  "build:worker": "node script/build-worker.mjs",
  "pack": "npm run build && node script/make-dlient.mjs",
  "prepublishOnly": "npm run pack",
  "dev:watch": "vite build --watch",
  "dev:watch:worker": "node script/build-worker.mjs --watch",
  "dev": "concurrently -k \"npm:dev:watch\" \"npm:dev:watch:worker\""
}
```

| Change | Why |
| --- | --- |
| `build:worker` → `node script/build-worker.mjs` | Produces `dist/worker.js` |
| `dev:watch:worker` → `node script/build-worker.mjs --watch` | Rebuild the worker on change |
| `build` gains `&& npm run build:worker` | One `npm run build` still builds everything |
| `dev` → `concurrently -k …` | Runs the UI and worker watchers together |

### 3.2 devDependencies

```jsonc
"devDependencies": {
  "esbuild": "^0.20.0",
  "concurrently": "^9.1.0"
}
```

`esbuild` is required by `script/build-worker.mjs`; `concurrently` is only needed for the combined
`dev` script. Run `npm install` afterwards.

### 3.3 manifest shape

No new manifest field is strictly required — the host forks a worker when `dist/worker.js` exists and
the manifest `type` allows it (`full`, `worker`, or `app`). The template keeps `"type": "app"`; set
`"type": "full"` if you prefer the explicit UI + worker shape (see `references/manifest-schema.md`).

## 4. Permissions & the expose policy

Add to `dlient.permissions`:

```jsonc
"permissions": ["log"]
```

`log` lets the worker write to its own log (`rpc.log.write` → `plugin-data/<id>/logs/main.log`) with
no fs permission. Add the other host-api keys your worker actually calls (`fs.read`, `child.spawn`,
`app.data`, …); resource access additionally needs `fsDirs` / `spawnCmds` or a runtime grant.

> **Expose policy — expose as little as possible.** Add `dlient.expose` entries **only** if another
> plugin genuinely must call this one (or the user explicitly asks). A plugin can expose methods
> **only if it actually ships a worker** — i.e. its build output contains `dist/worker.js`; the
> manifest `type` is irrelevant, so `full` / `worker` and any `app` / `ui` plugin that ships
> `dist/worker.js` all qualify, while a plugin with no `dist/worker.js` cannot (nothing serves the
> call → `WORKER_NOT_RUNNING`, `-2102`). When you do expose:
>
> - prefer to also expose the `grant` handler (recommended, not required)
>   (`"expose": { "grant": { "description": "…", "access": "default" } }`)
>   and prefer returning `{ status: 'ask' }` so the user decides at call time;
> - return `{ status: 'deny' }` for anything touching user privacy, passwords, keys or tokens.
>
> See `references/worker.md` §4.2–4.3.

## 5. `skills/SKILL.md`

Ship an agent skill **only now** that a worker exists — a UI-only plugin must not include `skills/`.
Minimal skeleton:

````md
---
name: "__PLUGIN_ID__"
description: "One line: what this plugin does and when an agent should invoke it."
---

# __PLUGIN_ID__

One paragraph: what the plugin does and the host capabilities it uses.

## Methods

| Method | Args | Returns | Description |
| --- | --- | --- | --- |
| `__PLUGIN_ID__.greet` | `name?` | `string` | Return a greeting message |

## Example

```ts
const msg = await rpc.plugin.invoke('__PLUGIN_ID__', '__PLUGIN_ID__.greet', ['world'])
```
````

Keep `skills/SKILL.md` under `skills/`; it is packed into the `.dlient` as-is.

## 6. Verify & revert

**Build**

```bash
npm install
npm run build         # → dist/remoteEntry.js (UI) + dist/worker.js (worker)
```

Confirm `dist/worker.js` exists. The host only forks a worker when that file is present.

**Confirm the host loads it**

1. Dev flow: place the project under `dlient-open/plugins/<pluginId>` and run `npm run dev`
   (output-level watch). Reopen / reload the host to pick up changes.
2. Import flow: `npm run pack`, then host console → **"Import plugin"** → pick the `.dlient`.
3. Check `USER_DATA/plugin-data/<pluginId>/logs/main.log` (`USER_DATA` = `~/.dlient-open`) — you
   should see the worker's `log` lines (e.g. from the example `greet` handler).

**Revert (back to UI-only)**

- delete `src/main/` and `dist/worker.js`;
- remove the `build:worker` and `dev:watch:worker` scripts and the `&& npm run build:worker` step from
  the `build` chain (and `esbuild` if nothing else uses it);
- remove `dlient.expose` and `skills/`;
- make sure the UI no longer calls the worker (`api.request(...)` / worker RPC).

## 7. References

- `.agent/example/worker/` — the copy-ready sources used above.
- `references/worker.md` — worker SDK/RPC, logging, subprocess handles, expose + grant.
- `references/native-host.md` — add native `.node` modules on top of the worker.
- `references/manifest-schema.md` — every `dlient.*` field (`type`, `permissions`, `expose`, …).
- `references/mode-switch-native-host.md` — the next step up (worker + native modules).
