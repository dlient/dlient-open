/**
 * @dlient-open/native-host-sdk —— 原生模块按用户侧安装（docs/todo/16-native-host.md）。
 *
 * 纯 Node 实现（仅 node:*，零外部依赖，无 Electron 耦合）：
 *   - protocol：length-prefixed JSON 帧编解码（+ NDJSON 调试开关）；
 *   - server：官方 Node 子进程（native-host.js）内的 service 注册表 + stdio JSON-RPC
 *             + 流式分块 + 事件推送 + 心跳 + 优雅关闭；
 *   - client：插件 worker 侧的 RPC 客户端（超时 / host 崩溃 reject / 心跳失联 / 流式 / 事件）
 *             + spawnNativeHost 便捷封装（环境变量剥离）。
 *
 * 用法（native-host.js，纯 Node 入口）：
 *   import { createNativeHostServer } from '@dlient-open/native-host-sdk'
 *   const host = createNativeHostServer()
 *   host.registerService('sqlite', { query: (params) => db.prepare(params[0]).all() }, () => db.close())
 *
 * 用法（插件 worker；宿主代管，沙箱兼容）：
 *   import { createNativeHostClient, createHostedTransport } from '@dlient-open/native-host-sdk'
 *   // 官方 node 运行时由内置 nodejs.* host-api 解析（rpc.nodejs.resolveRuntime；开源版宿主无 nodejs 插件），
 *   // rpc.createNativeHost 内部完成解析 + 宿主代 spawn + 崩溃自动重启：
 *   const { host, client, error } = await rpc.createNativeHost('native-host.js')
 *   await client.call('sqlite', 'query', ['SELECT 1'])
 *   // 低层手动路径（自己解析 node 并代 spawn）：rpc.nodejs.resolveRuntime() → rpc.child.spawn(...) → createHostedTransport(handle)
 *   // 旧模型（worker 直连 spawn）仍支持：createNativeHostClient({ proc, dispose })
 */

export * from './protocol'
export * from './server'
export * from './client'
