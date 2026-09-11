/**
 * __PLUGIN_ID__ worker 入口（src/main/index.ts）—— 可直接复制的 native-host 示例。
 *
 * worker 保持沙箱化（纯 Node 进程，无 `.node` addon）。原生模块经
 * native-host SDK 访问：worker 通过 rpc.child.spawn 拉起一个全权限的官方 Node
 * 子进程（`dist/native-host.js`，由 src/native-host/index.ts 构建），并与其
 * 以长度前缀的 JSON-RPC 通信。worker 本身绝不加载 `.node`
 * 二进制——只加载 SDK client。
 *
 * 把本文件复制到 src/main/index.ts，并把它旁边的 src/native-host/index.ts 一并
 * 复制，然后按 references/mode-switch-native-host.md 完成 manifest / scripts 改动。
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

// 惰性、可自动重启的 native-host client：首次调用时才拉起子进程，
// 崩溃后会重新拉起。这样注册可避免未使用时占用进程。
const buildHost = () => {
  const host = createRestartableNativeHost({
    maxRestarts: 3, // 反复崩溃 / 运行时缺失后放弃
    spawn: async () => {
      // 解析官方 Node 运行时（在 manifest.permissions 声明 `nodejs.resolveRuntime`）。
      // 其 ABI 与原生模块一致——无需 @electron/rebuild。
      const rt = (await rpc.nodejs.resolveRuntime({ version: '22' })) as { node?: string }
      if (!rt.node) throw new Error('node runtime not available')
      const distDir = fileURLToPath(new URL('.', import.meta.url)) // worker.js 与 native-host.js 共用 dist/
      const handle = await rpc.child.spawn({
        cmd: rt.node,
        args: [join(distDir, 'native-host.js')],
        cwd: distDir,
        description: 'native-host (native modules)',
      })
      const client = createNativeHostClient({ transport: createHostedTransport(handle) })
      return { client }
    },
    // 每次（重）启动后调用，让 native service 重新初始化自身状态。
    onRestarted: async (client) => {
      const userData = (await rpc.app.getPath('userData')) as string // 需要声明 app.getPath
      await client.call('example', 'init', [join(userData, 'native')])
    },
  })
  host.onExit(({ code, reason }) => void rpc.log.write('warn', 'native-host exited', { code, reason }))
  return host
}

let host: ReturnType<typeof buildHost> | undefined
const ensureHost = () => (host ??= buildHost()) // 惰性启动；崩溃 → 下次调用自动重启

// ---- 示例方法：转发到 src/native-host/index.ts 中注册的 service ----
// 跨插件调用时，把调用方身份作为参数一并转发，并在 native-host 中
// 重新校验（纵深防御）。见 references/native-host.md §6。
rpc.registerHandler('__PLUGIN_ID__.echo', async ([value]: [unknown]) => {
  const h = ensureHost()
  return h.call('example', 'echo', [value])
})

// ---- 特殊的 `grant` handler（见 references/worker.md §4.3）----
rpc.registerHandler('grant', async () => ({
  // 'allow' | 'ask' | 'deny'。优先 'ask'；对涉及用户隐私、密码、密钥或
  // token 的一律返回 'deny'。
  status: 'ask' as const,
}))
