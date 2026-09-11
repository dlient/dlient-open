/**
 * __PLUGIN_ID__ worker entry (src/main/index.ts) — copy-ready native-host example.
 *
 * The worker stays sandboxed (plain Node process, no `.node` addons). Native modules are
 * reached through the native-host SDK: the worker spawns a full-permission official-Node
 * child (`dist/native-host.js`, built from src/native-host/index.ts) via rpc.child.spawn
 * and talks to it over length-prefixed JSON-RPC. The worker never loads the `.node`
 * binary itself — only the SDK client.
 *
 * Copy this file to src/main/index.ts and src/native-host/index.ts alongside it, then
 * follow references/mode-switch-native-host.md for the manifest / scripts changes.
 */

import { createWorkerRpc } from '@dlient-open/plugin-sdk'
import {
  createHostedTransport,
  createNativeHostClient,
  createRestartableNativeHost,
} from '@dlient-open/native-host-sdk'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const rpc = createWorkerRpc('__PLUGIN_ID__')

// Lazy, auto-restarting native-host client: the child is spawned on the first call and
// re-spawned after a crash. Registering the host this way avoids a process when unused.
const buildHost = () => {
  const host = createRestartableNativeHost({
    maxRestarts: 3, // give up after repeated crash / missing-runtime failures
    spawn: async () => {
      // Resolve the official Node runtime (declare `nodejs.resolveRuntime` in
      // manifest.permissions). Its ABI matches the native modules — no @electron/rebuild.
      const rt = (await rpc.nodejs.resolveRuntime({ version: '22' })) as { node?: string }
      if (!rt.node) throw new Error('node runtime not available')
      const distDir = fileURLToPath(new URL('.', import.meta.url)) // worker.js and native-host.js share dist/
      const handle = await rpc.child.spawn({
        cmd: rt.node,
        args: [join(distDir, 'native-host.js')],
        cwd: distDir,
        description: 'native-host (native modules)',
      })
      const client = createNativeHostClient({ transport: createHostedTransport(handle) })
      return { client }
    },
    // Called after every (re)start so the native service can re-initialize its state.
    onRestarted: async (client) => {
      const userData = (await rpc.app.getPath('userData')) as string // needs `app.getPath` declared
      await client.call('example', 'init', [join(userData, 'native')])
    },
  })
  host.onExit(({ code, reason }) => void rpc.log.write('warn', 'native-host exited', { code, reason }))
  return host
}

let host: ReturnType<typeof buildHost> | undefined
const ensureHost = () => (host ??= buildHost()) // lazy start; crash → auto-restart on the next call

// ---- Example method: forward to a service registered in src/native-host/index.ts ----
// For cross-plugin calls, forward the caller identity as a parameter and re-validate it
// in the native-host (defense in depth). See references/native-host.md §6.
rpc.registerHandler('__PLUGIN_ID__.echo', async ([value]: [unknown]) => {
  const h = ensureHost()
  return h.call('example', 'echo', [value])
})

// ---- Special `grant` handler (see references/worker.md §4.3) ----
rpc.registerHandler('grant', async () => ({
  // 'allow' | 'ask' | 'deny'. Prefer 'ask'; return 'deny' for anything touching user
  // privacy, passwords, keys or tokens.
  status: 'ask' as const,
}))
