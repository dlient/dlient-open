/**
 * pool-worker.ts - 共享 worker 池运行时（utilityProcess 执行面）。
 *
 * 池 = 一个 utilityProcess 进程，按 pluginId 加载多个插件的 worker.js（esbuild 单文件 bundle）。
 * 每插件两条独立 MessagePortMain（控制面 ctl + 渲染层直连 direct）经 transfer 进池，
 * 通过 globalThis.__dlientPoolCtx 交给该插件的 createWorkerRpc（@dlient-open/plugin-sdk 内同步读取，
 * 插件源码零改动）。
 *
 * 池形态（全池化，无独立进程模式）：
 *  - 共享池：一进程多插件（按类型分池，容量 8）；solo 池：一进程一插件（容量 1，dev /
 *    workerMode:'solo' / 阶段 2 观察期与隔离版本），崩溃/同步阻塞只影响自己；
 *  - 控制/直连通道均为注入的 MessagePortMain——SDK 兼容 poolCtx 注入与 parentPort 两路；
 *  - process.exit 被拦截：池内调用会杀掉整池（连同其它插件），转为抛错提示；
 *  - reload（热重载/重启）= import() + query cache-bust（?t=loadSeq 自增），不重启进程；
 *    注意：不能走 require + delete require.cache —— require(esm) 的 ESM 模块缓存独立于
 *    require.cache（实测 delete 后重新 require 仍命中缓存、模块不重新执行），unload 后
 *    重载会用旧 SDK 实例/旧端口导致握手失败；import() 每次用不同 query 使缓存 key 不同。
 *  - 池崩溃由主进程 PoolManager 感知（整池重建），本文件只负责多插件加载与路由。
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

type PoolMessage =
  | { type: 'load-plugin'; pluginId: string; workerEntry: string; generation: number }
  | { type: 'unload-plugin'; pluginId: string; workerEntry: string }
  | { type: 'reattach-direct'; pluginId: string }
  | { type: 'ping' }

const require = createRequire(import.meta.url)

const POOL_CTX_KEY = '__dlientPoolCtx'
const RPC_TABLE_KEY = '__dlientRpcTable'

/** process.parentPort（Electron utilityProcess 特有，类型扩展） */
const parentPort = (process as unknown as {
  parentPort?: {
    on(event: 'message', listener: (event: { data: PoolMessage; ports?: Electron.MessagePortMain[] }) => void): void
    postMessage(message: unknown): void
  }
}).parentPort

if (!parentPort) {
  console.error('[pool-worker] parentPort not available; pool worker must run in Electron utilityProcess')
}

// process.exit 拦截：池内插件直接 process.exit 会杀掉整个池（连同其它插件），
// 转为抛错（load 流程捕获后报 load-failed，提示开发者）。独立进程模式 exit 只杀自己，语义不同。
;(process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
  throw new Error(`[pool-worker] process.exit(${code}) is blocked inside shared pool; call unload instead`)
}) as typeof process.exit

/** load/unload 串行队列：import() 是异步的，串行保证 POOL_CTX 不被并发 load 交错覆盖 */
let poolOpQueue: Promise<void> = Promise.resolve()
/** cache-bust 自增序列：每次 load 绝对唯一，替代 generation（uninstall 可能重置 generation，
 *  与上次相同会导致 ESM 缓存命中、worker.js 不重新执行 → 旧 SDK 实例用已关闭的旧端口） */
let loadSeq = 0

/** 异步加载插件 worker（import + query cache-bust，绕过 ESM 缓存保证重新执行） */
async function loadPlugin(
  msg: { pluginId: string; workerEntry: string; generation: number },
  ctl: Electron.MessagePortMain | undefined,
  direct: Electron.MessagePortMain | undefined,
): Promise<void> {
  try {
    // 端口激活：MessagePortMain 在 start() 前 postMessage 的消息会排队，SDK 的 direct-port-ready
    // 在 ctl.start() 之前发出（worker.js: setupDirectPort → sendMessage 先于 if(ctl){ctl.start}），
    // start 前排队消息此场景下丢失 → 握手失败。transfer 后先 start 再注入，worker 拿到已激活端口，
    // postMessage（direct-port-ready）立即发送。start 幂等，worker 内再 start 无害。
    try {
      ctl?.start?.()
    } catch {
      /* 已启动忽略 */
    }
    try {
      direct?.start?.()
    } catch {
      /* 已启动忽略 */
    }
    // 每次 load 用不同 query（loadSeq 自增，绝对唯一）使 ESM 缓存 key 不同 → 模块必重新执行；
    // fileURLToPath(import.meta.url) 会忽略 query，不影响 worker 内相对资源定位。
    // 不能用 generation：uninstall → removeRuntime 后 generation 可能重置，与上次相同则缓存命中
    const url = `${pathToFileURL(msg.workerEntry).href}?t=${++loadSeq}`
    // 握手探针：SDK 的 setupDirectPort 依赖 directInit = poolCtx?.directPort（模块顶层同步读取）。
    // directPort 用 getter 暴露，被读取即代表 SDK 已自行完成握手（已挂上 message 监听）；
    // 未被读取才需 import 后经 rpcTable 补触发。不可无条件补触发：SDK 的 setupDirectPort 每次
    // 调用都会对同一 port 新增一条 message 监听（RpcChannel 无 off/close，旧监听无法解绑），
    // 重复调用 → 同一 request 被投递两次 → handler 执行两次（副作用双份，如系统弹框弹两次），
    // 而两条同 request_id 响应中的第二条会被 preload 静默丢弃 → 渲染层完全观测不到异常。
    let directPortRead = false
    // 插件 createWorkerRpc 在模块顶层同步读取该上下文；import resolve 后仍可被下一插件覆盖
    ;(globalThis as Record<string, unknown>)[POOL_CTX_KEY] = {
      pluginId: msg.pluginId,
      controlPort: ctl,
      get directPort(): Electron.MessagePortMain | undefined {
        directPortRead = true
        return direct
      },
    }
    await import(url)
    // 兜底握手：SDK 未读取 directPort（未调用 setupDirectPort → 无 direct-port-ready，但 rpcTable
    // 照常注册）时，经 rpcTable 补触发 setDirectPort（= setupDirectPort）。
    if (!directPortRead && direct) {
      const rpcTable = (globalThis as Record<string, unknown>)[RPC_TABLE_KEY] as
        | { [pluginId: string]: unknown }
        | undefined
      const entry = rpcTable?.[msg.pluginId] as
        | { setDirectPort?: (port: Electron.MessagePortMain | undefined) => void }
        | undefined
      entry?.setDirectPort?.(direct)
    }
    parentPort?.postMessage({ type: 'load-ok', pluginId: msg.pluginId })
  } catch (err) {
    ;(globalThis as Record<string, unknown>)[POOL_CTX_KEY] = undefined
    parentPort?.postMessage({
      type: 'load-failed',
      pluginId: msg.pluginId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

parentPort?.on('message', (event) => {
  const msg = event.data
  const ports = (event.ports ?? []) as Electron.MessagePortMain[]
  switch (msg.type) {
    case 'load-plugin': {
      const [ctl, direct] = ports
      poolOpQueue = poolOpQueue.then(() => loadPlugin(msg, ctl, direct))
      break
    }
    case 'unload-plugin': {
      // 与 load 串行；require.cache 清理仅作兜底（ESM 缓存由 load 侧 query 绕过）
      poolOpQueue = poolOpQueue.then(() => {
        try {
          delete require.cache[require.resolve(msg.workerEntry)]
        } catch {
          /* 忽略 */
        }
        parentPort?.postMessage({ type: 'unload-ok', pluginId: msg.pluginId })
      })
      break
    }
    case 'reattach-direct': {
      // 渲染层直连通道重建（refreshDirectPort）：换新 direct port 并让插件 rpc 重新监听
      const [direct] = ports
      const entry = (globalThis as Record<string, unknown>)[RPC_TABLE_KEY] as
        | { [pluginId: string]: { setDirectPort?: (port: Electron.MessagePortMain) => void } }
        | undefined
      entry?.[msg.pluginId]?.setDirectPort?.(direct)
      break
    }
    case 'ping': {
      parentPort?.postMessage({ type: 'pong' })
      break
    }
  }
})

// 池存活心跳：主进程 PoolManager 据此判定池是否失联
setInterval(() => {
  parentPort?.postMessage({ type: 'pool-heartbeat', ts: Date.now() })
}, 10000)
