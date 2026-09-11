# Example: worker mode (UI + worker)

Copy-ready sources for converting a UI-only (`default`) plugin into the **worker** mode.
The worker is a plain sandboxed Node process and reaches the host
through **host-api** (`rpc.*`).

## Files

| File | Copy to | Purpose |
| --- | --- | --- |
| `src/main/index.ts` | `src/main/index.ts` | Worker entry — `createWorkerRpc('<plugin-id>')`, one example handler and the `grant` handler |
| `build-worker.mjs` | `script/build-worker.mjs` | esbuild build → `dist/worker.js` (also emits `dist/native-host.js` when `src/native-host/index.ts` exists) |

`__PLUGIN_ID__` is a placeholder for your plugin id; replace it with the real id (the scaffolder does
this automatically for generated projects).

## What the worker registers

| Handler | Kind | Notes |
| --- | --- | --- |
| `__PLUGIN_ID__.greet` | example method | Callable by the host + this plugin. Add a `dlient.expose` entry only if another plugin must call it. |
| `grant` | special handler | Invoked by the host for cross-plugin authorization; returns `{ status: 'ask' \| 'allow' \| 'deny' }`. Only effective when `dlient.expose` declares a matching `"grant"` entry. |

## Read next

- `references/mode-switch-worker.md` — step-by-step manifest, `scripts` and `package.json` changes.
- `references/worker.md` — full worker SDK/RPC reference (handlers, logging, subprocesses, expose + grant).
- `references/manifest-schema.md` — every `dlient.*` manifest field.

> Inside a generated project these docs live under `.agent/references/`.
