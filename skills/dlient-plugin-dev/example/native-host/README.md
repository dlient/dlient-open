# Example: native-host mode (UI + worker + native modules)

Copy-ready sources for converting a plugin to the **native-host** mode: UI + worker + native
`.node` modules loaded by a dedicated **full-permission official-Node child** (no `@electron/rebuild`).
The child is spawned by the host on behalf of the worker and talks to it over JSON-RPC.

## Files

| File | Copy to | Purpose |
| --- | --- | --- |
| `src/main/index.ts` | `src/main/index.ts` | Worker entry — spawns the native-host child through `@dlient-open/native-host-sdk` and forwards calls; also registers the `grant` handler |
| `src/native-host/index.ts` | `src/native-host/index.ts` | Native-host entry — pure Node, loads the native modules and registers services |
| `build-worker.mjs` | `script/build-worker.mjs` | esbuild build → `dist/worker.js` and (because `src/native-host/index.ts` exists) `dist/native-host.js` |

`__PLUGIN_ID__` is a placeholder for your plugin id; replace it with the real id (the scaffolder does
this automatically for generated projects).

## How the two halves connect

```
worker (src/main/index.ts, sandboxed)
  └─ createRestartableNativeHost → rpc.child.spawn(official node, dist/native-host.js)
       └─ native-host (src/native-host/index.ts, full permission, pure Node)
            └─ native module loaded via createRequire from node_modules
```

## Read next

- `references/mode-switch-native-host.md` — step-by-step manifest, `scripts` and `package.json` changes.
- `references/native-host.md` — native-host architecture, server/client API, restart & security.
- `references/worker.md` — worker SDK/RPC reference (handlers, logging, expose + grant).
- `references/manifest-schema.md` — every `dlient.*` manifest field.

> Inside a generated project these docs live under `.agent/references/`.
