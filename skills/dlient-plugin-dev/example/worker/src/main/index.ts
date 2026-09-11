/**
 * __PLUGIN_ID__ worker entry (src/main/index.ts) — copy-ready worker example.
 *
 * Minimal worker for a UI + worker plugin: registers one example method
 * (naming convention: <plugin-id>.<method>) and the special `grant` handler.
 * The worker is a plain sandboxed Node process (no DOM).
 * Logging goes to plugin-data/__PLUGIN_ID__/logs/main.log (JSONL) via
 * rpc.log.write — declare `log` in manifest.permissions (no fs permission needed).
 *
 * Copy this file to src/main/index.ts, then follow references/mode-switch-worker.md
 * for the manifest / scripts / package.json changes.
 */

import { createWorkerRpc } from '@dlient-open/plugin-sdk'

const rpc = createWorkerRpc('__PLUGIN_ID__')

// ---- Example method ----
// Registering a handler only makes it callable by the host + this plugin.
// To let OTHER plugins call it, also add a matching entry to `dlient.expose`
// (see references/worker.md § Exposing methods). Only do that when another
// plugin genuinely must call this one.
rpc.registerHandler('__PLUGIN_ID__.greet', async ([name]: [string?]) => {
  void rpc.log.write('info', 'greet called', { from: 'worker' })
  // Returning plain data is enough: the SDK wraps it as { code: 0, data, from }.
  return `Hello ${name ?? 'world'} from __PLUGIN_ID__ worker`
})

// ---- Special `grant` handler ----
// The host calls the literal `grant` handler when another plugin needs
// authorization (or calls rpc.plugin.requestGrant). It only takes effect if
// `expose` declares a matching `"grant"` entry (see references/worker.md §4.3).
rpc.registerHandler('grant', async () => ({
  // 'allow' | 'ask' | 'deny'. Prefer 'ask' (let the user decide at call time);
  // return 'deny' for anything touching user privacy, passwords, keys or tokens.
  status: 'ask' as const,
}))
