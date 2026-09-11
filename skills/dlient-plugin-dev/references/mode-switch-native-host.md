# Mode switch: UI-only (`default`) → native-host (UI + worker + native modules)

This guide converts a **UI-only** plugin (scaffolded with no flag) into the **native-host** mode:
UI + worker + native `.node` modules loaded by a dedicated **full-permission official-Node child**.
Because the child runs the official Node runtime, native modules build against the official Node ABI —
there is **no `@electron/rebuild`** step.

Ready-to-copy sources live in `.agent/example/native-host/`.

## 1. When to choose this mode

Choose `native-host` when the plugin needs `.node` addons (e.g. `better-sqlite3`, `ssh2`, `node-pty`,
image/audio codecs) that cannot load inside the sandboxed worker.

Prefer `native-host` (`dlient.nativeModules`) over the vendored **`native`** path (`dlient.native`):

| | `native` (vendored + `@electron/rebuild`) | `native-host` (this guide) |
| --- | --- | --- |
| ABI | Electron ABI, rebuilt per platform | **official Node ABI** (no rebuild) |
| `.node` ships in | `dist`, vendored (must declare `platforms`) | not packaged; installed user-side with npm |
| Build step | `npm run build:native` on every target platform | none extra |

**Do not** use this mode when there are no native modules, or when a pure-JS alternative exists — a
native-host child is full-permission Node and raises the install-time trust level. A UI-only or plain
`worker` plugin stays simpler and safer.

> The two native paths are mutually exclusive: declare **either** `dlient.native` **or**
> `dlient.nativeModules`, never both. See `references/native-host.md`.

## 2. Files to add

Copy from `.agent/example/native-host/`:

| Copy from `.agent/example/native-host/` | To (project) | Notes |
| --- | --- | --- |
| `src/main/index.ts` | `src/main/index.ts` | Worker entry — spawns/forwards to the native-host, registers the `grant` handler |
| `src/native-host/index.ts` | `src/native-host/index.ts` | Native-host entry — pure Node, loads the native modules, registers services |
| `build-worker.mjs` | `script/build-worker.mjs` | esbuild build → `dist/worker.js` **and** `dist/native-host.js` (auto, because `src/native-host/` exists) |

The example uses the placeholder `__PLUGIN_ID__` — replace it with your plugin id (the scaffolder
already does this for generated projects).

Resulting layout (native-host-specific files marked `+`):

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
│   ├── native-host/
│   │   └── index.ts            # + added
│   └── renderer/               # UI (unchanged)
└── .agent/
```

## 3. `package.json` changes

### 3.1 `scripts`

Add `build:worker` and `dev:watch:worker`, and append `build:worker` to the `build` chain. **No extra
script is needed** for native-host: `build-worker.mjs` auto-emits `dist/native-host.js`.

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

### 3.2 `dlient` manifest fields

```jsonc
"dlient": {
  "native": false,
  "nativeModules": {
    "useBundledNode": true,
    "dependencies": {}
  }
}
```

| Field | Value | Notes |
| --- | --- | --- |
| `nativeModules.useBundledNode` | `true` | The native-host runs on the host's bundled official Node |
| `nativeModules.dependencies` | `{}` → fill in | npm package → version, e.g. `{ "better-sqlite3": "^11.0.0" }`; installed user-side on import |
| `native` | `false` | Mutually exclusive with `nativeModules` — keep it `false` |

### 3.3 devDependencies

```jsonc
"devDependencies": {
  "@dlient-open/native-host-sdk": "^0.1.1",
  "esbuild": "^0.20.0",
  "concurrently": "^9.1.0",
  "better-sqlite3": "^11.0.0"
}
```

- `@dlient-open/native-host-sdk` — worker-side client + native-host server.
- `esbuild` — required by `script/build-worker.mjs` (`concurrently` only for the combined `dev`).
- Also add each native package from `nativeModules.dependencies` to `devDependencies` for local
  build / typings. Run `npm install` afterwards.

## 4. Permissions & the expose policy

Add to `dlient.permissions`:

```jsonc
"permissions": ["log", "nodejs.resolveRuntime", "child.spawn"]
```

| Permission | Needed by |
| --- | --- |
| `log` | `rpc.log.write` (worker + native-host logs) |
| `nodejs.resolveRuntime` | the example worker resolves the official Node binary path |
| `child.spawn` | the example worker spawns the native-host child (`rpc.child.spawn`) |

`app.getPath` has no group prefix, so it must be declared as the exact key `app.getPath` in
`dlient.permissions` (no resource grant is needed, but the declaration is). The command whitelist / runtime
grant still applies to the
`child.spawn` of the resolved Node binary (declare `spawnCmds` if needed). See
`references/permission-model.md`.

> **Expose policy — expose as little as possible.** Add `dlient.expose` entries **only** if another
> plugin genuinely must call this one (or the user explicitly asks). A plugin can expose methods
> **only if it actually ships a worker** — i.e. its build output contains `dist/worker.js`; the
> manifest `type` is irrelevant, and because this mode ships a worker it is free to expose. When you
> do expose:
>
> - prefer to also expose the `grant` handler (recommended, not required)
>   (`"expose": { "grant": { "description": "…", "access": "default" } }`)
>   and prefer returning `{ status: 'ask' }`;
> - return `{ status: 'deny' }` for anything touching user privacy, passwords, keys or tokens.
>
> See `references/worker.md` §4.2–4.3. Treat native-host access as install-level trust:
> keep the service surface narrow and re-validate every parameter (see `references/native-host.md` §8).

## 5. `skills/SKILL.md`

Ship an agent skill **only now** that a worker exists — a UI-only plugin must not include `skills/`.
Minimal skeleton:

````md
---
name: "__PLUGIN_ID__"
description: "One line: what this plugin does and when an agent should invoke it."
---

# __PLUGIN_ID__

One paragraph: what the plugin does, which native modules it uses and why.

## Methods

| Method | Args | Returns | Description |
| --- | --- | --- | --- |
| `__PLUGIN_ID__.echo` | `value` | `unknown` | Forward to the native-host `example.echo` service |

## Example

```ts
const out = await rpc.plugin.invoke('__PLUGIN_ID__', '__PLUGIN_ID__.echo', ['hello'])
```
````

Keep `skills/SKILL.md` under `skills/`; it is packed into the `.dlient` as-is.

## 6. Verify & revert

**Build**

```bash
npm install
npm run build         # → dist/remoteEntry.js + dist/worker.js + dist/native-host.js
```

Confirm **both** `dist/worker.js` and `dist/native-host.js` exist. The build only emits
`native-host.js` when `src/native-host/index.ts` is present.

**Confirm the host loads it**

1. Dev flow: place the project under `dlient-open/plugins/<pluginId>` and run `npm run dev`; reopen /
   reload the host to pick up changes.
2. Import flow: `npm run pack`, then host console → **"Import plugin"** → pick the `.dlient`. The host
   installs `nativeModules.dependencies` user-side (needs `npm install` on import).
3. Exercise an exposed method (e.g. `__PLUGIN_ID__.echo`) and check
   `USER_DATA/plugin-data/<pluginId>/logs/main.log` (`USER_DATA` = `~/.dlient-open`) for worker +
   native-host log lines.

**Revert (back to UI-only)**

- delete `src/main/`, `src/native-host/`, `dist/worker.js` and `dist/native-host.js`;
- remove the `build:worker` / `dev:watch:worker` scripts and the `&& npm run build:worker` step;
- remove `dlient.nativeModules` (and `native: false`), `@dlient-open/native-host-sdk`, `dlient.expose`
  and `skills/`;
- drop `nativeModules.dependencies` from `devDependencies`;
- make sure the UI no longer calls the worker.

To keep the worker but drop only the native modules, see the revert note in `references/native-host.md`.

## 7. References

- `.agent/example/native-host/` — the copy-ready sources used above.
- `references/native-host.md` — native-host architecture, server/client API, restart & security.
- `references/worker.md` — worker SDK/RPC, logging, expose + grant.
- `references/manifest-schema.md` — every `dlient.*` field (`native`, `nativeModules`, `permissions`, …).
- `references/mode-switch-worker.md` — the plain worker mode (no native modules).
