/**
 * __PLUGIN_ID__ native-host 入口（src/native-host/index.ts）。
 *
 * native-host 模式（docs/todo/16-native-host.md §16.5）：原生模块跑在**官方 Node 子进程**，
 * 经 stdio length-prefixed JSON-RPC 与插件 worker 通信 —— 彻底绕开 Electron ABI / @electron/rebuild。
 *
 * 关键点：
 *   - 本文件**必须纯 Node**（仅 node:* + 你的原生模块），不得依赖 electron / worker SDK；
 *   - 原生模块在构建时 external 不打包（build-worker.mjs 读取 manifest nativeModules 自动处理），
 *     运行时经 createRequire 从插件目录 node_modules 解析（ABI 匹配官方 Node）；
 *   - 插件 worker 侧用 @dlient-open/native-host-sdk 的 spawnNativeHost 启动本进程并调用 service。
 *
 * 使用：
 *   1. 在 package.json 声明 dlient.nativeModules.dependencies（如 { "better-sqlite3": "^11.0.0" }）；
 *   2. 把原生模块也加入 devDependencies（本地开发/构建期类型）；
 *   3. 参照下方 registerService 实现你的 service 方法，worker 侧经 rpc.createNativeHost('native-host.js')
 *      （内置 nodejs.* host-api 解析官方 Node 并宿主代 spawn）或 @dlient-open/native-host-sdk 客户端调用。
 */

import { createRequire } from 'node:module'
import { createNativeHostServer } from '@dlient-open/native-host-sdk'

const require = createRequire(import.meta.url)

// 示例：原生模块经 createRequire 解析（esbuild external，运行时从插件目录 node_modules 加载）
// const NativeLib = require('your-native-package') as typeof import('your-native-package')

const host = createNativeHostServer()

// ---- 示例 service（替换为你的业务 service）----

host.registerService(
  'example',
  {
    /** 示例方法：返回入参原样（可在此调用原生模块能力） */
    echo: (params) => {
      // 原生模块调用示例：
      // const result = NativeLib.doSomething(params)
      // return result
      return { ok: true, echoed: params?.[0] }
    },
  },
  () => {
    // 优雅关闭：关闭连接 / 释放资源（host close 时触发）
  },
)
