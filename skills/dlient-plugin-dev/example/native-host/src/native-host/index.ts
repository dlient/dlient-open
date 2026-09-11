/**
 * __PLUGIN_ID__ native-host entry (src/native-host/index.ts) — copy-ready example.
 *
 * Runs in a full-permission OFFICIAL Node child process (spawned by the host on behalf of
 * the worker). Native modules build against the official Node ABI, so there is no
 * @electron/rebuild step. Communication with the worker is length-prefixed JSON-RPC over
 * stdin/stdout.
 *
 * Rules:
 *   - this file must be PURE Node (only node:* plus your native modules) — no `electron`,
 *     no worker SDK;
 *   - native modules are kept external at build time (build-worker.mjs reads the manifest
 *     nativeModules) and resolved at runtime via createRequire from the plugin node_modules;
 *   - the plugin worker starts this process with @dlient-open/native-host-sdk and calls the
 *     registered services.
 *
 * Setup:
 *   1. declare dlient.nativeModules.dependencies in package.json, e.g. { "better-sqlite3": "^11.0.0" };
 *   2. add the native package to devDependencies too (local build/typing);
 *   3. implement your service methods below and call them from the worker via the SDK client
 *      (see references/native-host.md §6).
 */

import { createRequire } from 'node:module'
import { createNativeHostServer } from '@dlient-open/native-host-sdk'

const require = createRequire(import.meta.url)

// Example: resolve a native module via createRequire (esbuild external; loaded at runtime
// from the plugin node_modules, which matches the official Node ABI).
// const NativeLib = require('your-native-package') as typeof import('your-native-package')

const host = createNativeHostServer()

// ---- Example service (replace with your business service) ----

host.registerService(
  'example',
  {
    /** Example method: echoes its first param (call your native module here instead). */
    echo: (params) => {
      // Native module call example:
      // const result = NativeLib.doSomething(params)
      // return result
      return { ok: true, echoed: params?.[0] }
    },
  },
  () => {
    // Graceful close: release resources / close connections (runs when the host closes).
  },
)
