/**
 * 示例 native-host 入口（N4 验收：官方 Node 起 native-host 能 echo / 流式输出 / 事件）。
 * 运行：node dist/example-host.mjs [--ndjson]
 * 由官方 Node（非 Electron）执行；作为插件 src/native-host/index.ts 的参考实现。
 */

import { createNativeHostServer } from './server'
import { createRequire } from 'node:module'

// 解析原生模块的参考方式：createRequire(import.meta.url) 相对本入口位置解析插件目录 node_modules
const require = createRequire(import.meta.url)

const host = createNativeHostServer()

host.registerService(
  'echo',
  {
    // 普通 RPC：返回参数
    echo: (params) => params,
    // 抛错 → { ok:false, error }
    fail: () => {
      throw new Error('boom from native-host')
    },
    // 事件触发：worker 侧 onEvent 订阅
    notify: (_params, ctx) => {
      host.emit('pong', { ts: Date.now() })
      return { sent: true }
    },
  },
  () => console.error('[example-host] echo service closing'),
)

// 流式 service：AsyncIterable → 逐块 more:true，结束发最终包
host.registerService('stream', {
  numbers: async function* (params: unknown[] | undefined) {
    const n = Number(params?.[0] ?? 5)
    for (let i = 1; i <= n; i++) {
      yield { i, value: i * i }
      await new Promise((r) => setTimeout(r, 10))
    }
  },
})

// 原生模块解析示例（未安装时跳过，不阻断进程）：require('better-sqlite3')
try {
  const db = require('better-sqlite3')
  host.registerService('sqlite', {
    version: () => db.constructor?.prototype?.constructor?.name ?? 'better-sqlite3',
  })
} catch {
  /* 未安装 better-sqlite3：跳过 sqlite service */
}
