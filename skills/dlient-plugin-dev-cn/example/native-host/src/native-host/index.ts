/**
 * __PLUGIN_ID__ native-host 入口（src/native-host/index.ts）—— 可直接复制的示例。
 *
 * 运行在全权限的官方 Node 子进程中（由宿主代表 worker 拉起）。原生模块
 * 按官方 Node ABI 构建，因此无需 @electron/rebuild。与 worker 的通信
 * 是基于 stdin/stdout 的长度前缀 JSON-RPC。
 *
 * 规则：
 *   - 本文件必须是**纯 Node**（只用 node:* 加你自己的原生模块）——不得用 `electron`，
 *     不得用 worker SDK；
 *   - 原生模块在构建时保持 external（build-worker.mjs 读取 manifest 的
 *     nativeModules），运行时经 createRequire 从插件 node_modules 解析；
 *   - 插件 worker 用 @dlient-open/native-host-sdk 启动本进程，并调用
 *     已注册的 service。
 *
 * 配置：
 *   1. 在 package.json 声明 dlient.nativeModules.dependencies，如 { "better-sqlite3": "^11.0.0" }；
 *   2. 把原生包也加到 devDependencies（本地构建 / 类型）；
 *   3. 在下方实现你的 service 方法，并从 worker 经 SDK client 调用它们
 *      （见 references/native-host.md §6）。
 */

import { createRequire } from 'node:module'
import { createNativeHostServer } from '@dlient-open/native-host-sdk'

const require = createRequire(import.meta.url)

// 示例：经 createRequire 解析原生模块（esbuild external；运行时从插件
// node_modules 加载，其 ABI 与官方 Node 一致）。
// const NativeLib = require('your-native-package') as typeof import('your-native-package')

const host = createNativeHostServer()

// ---- 示例 service（替换为你的业务 service）----

host.registerService(
  'example',
  {
    /** 示例方法：回显第一个参数（此处应改为调用你的原生模块）。 */
    echo: (params) => {
      // 原生模块调用示例：
      // const result = NativeLib.doSomething(params)
      // return result
      return { ok: true, echoed: params?.[0] }
    },
  },
  () => {
    // 优雅关闭：释放资源 / 关闭连接（宿主关闭时执行）。
  },
)
