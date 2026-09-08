/**
 * native-host 客户端（docs/todo/16-native-host.md §16.6）。
 * 插件 worker 侧使用：起官方 Node 子进程（native-host.js）后，用本客户端做 length-prefixed JSON-RPC。
 *
 * 关键语义：
 *   - **崩溃即一等错误**：host 进程 exit → 拒绝所有挂起请求（而非无限等待），并触发 onExit 回调；
 *   - **RPC 超时**：每请求默认 30s 超时；流式请求按流维护，不整体超时；
 *   - **心跳失联**：host 每 10s 发 { ping }，本端若超过 heartbeatTimeoutMs 未收到任何帧视为失联，
 *     走同一清理路径（拒绝挂起 + onExit）；
 *   - **流式分块**：同 id 多条 more:true 帧增量传输，more:false / 缺省为最终包；
 *   - **事件**：{ event, data } 帧 → onEvent 订阅分发；
 *   - **优雅关闭**：dispose() 先通知 host 关闭资源（service onClose）再 kill 进程树（dispose 回调）。
 *
 * 纯 Node 实现（仅 node:child_process / node:events），与 plugin-sdk 无耦合。
 * 传输层抽象为 NativeHostTransport，支持两种来源：
 *   - **宿主代管（推荐，沙箱兼容）**：插件 worker 用 @dlient-open/plugin-sdk 的 `spawnHosted` 经宿主
 *     `child.spawn` 拉起，`createHostedTransport(handle)` 适配为传输（stdin 经 child.writeStdin、
 *     stdout 经 child-event 流式推送）；
 *   - **旧模型（直连）**：worker 内自行 spawn 的 ChildProcess（stdio pipe），直接传 `proc`。
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { encodeFrame, FrameDecoder, type ClientMessage, type HostMessage, type RpcRequest } from './protocol'

/**
 * 宿主代管子进程传输抽象（ChildHandle 适配；结构类型，不依赖 plugin-sdk）。
 * 插件 worker 侧：spawnHosted 拿到 ChildHandle → createHostedTransport(handle) 得到本接口。
 */
export interface NativeHostTransport {
  /** 写 stdin（UTF-8 帧或原始 Buffer；等价原 proc.stdin.write） */
  write(chunk: string | Buffer): void
  /** stdin 结束（优雅关闭信号；等价原 proc.stdin.end()，可选） */
  end?(): void
  /** stdout 流式订阅（帧源；child-event onStdout） */
  onStdout(cb: (chunk: string) => void): void
  /** 进程退出（code；child-event onExit） */
  onExit(cb: (code: number | null) => void): void
  /** 启动失败 / 运行错误（child-event onError） */
  onError(cb: (err: Error) => void): void
  /** 回收进程树（kill；宿主代管 = handle.kill） */
  kill(): void | Promise<void>
}

export interface NativeHostClientOptions {
  /** 宿主代管传输（推荐：createHostedTransport(ChildHandle)）；与 proc 二选一 */
  transport?: NativeHostTransport
  /** 旧模型：worker 内自 spawn 的 ChildProcess（stdio 需 pipe stdin/stdout）；与 transport 二选一 */
  proc?: ChildProcess
  /** 关闭时整棵进程树回收（旧模型 proc 用：推荐 spawnTracked 的 dispose；缺省仅 proc.kill()） */
  dispose?: () => void
  /** 单请求超时 ms（默认 30000；流式请求不适用） */
  timeoutMs?: number
  /** 心跳失联阈值 ms（默认 33000；host 每 10s 发 ping） */
  heartbeatTimeoutMs?: number
  /** 调试用 NDJSON 帧（须与 host 启动的 --ndjson 一致；默认 false） */
  ndjson?: boolean
}

export interface StreamHandle<T = unknown> {
  onData: (cb: (chunk: T) => void) => void
  onDone: (cb: (result: T | undefined) => void) => void
  onError: (cb: (err: Error) => void) => void
  abort: () => void
}

export interface NativeHostClient {
  /** 普通 RPC：超时 / host 崩溃 / 失联都会 reject */
  call: <T = unknown>(service: string, method: string, params?: unknown[], opts?: { timeoutMs?: number }) => Promise<T>
  /** 流式 RPC：chunks 逐块回调，done 后 resolve；不整体超时 */
  stream: <T = unknown>(service: string, method: string, params?: unknown[]) => StreamHandle<T>
  /** 订阅 host 事件（{ event, data } 帧） */
  onEvent: (event: string, cb: (data: unknown) => void) => void
  /** host 进程退出 / 失联回调 */
  onExit: (cb: (info: { code: number | null; reason: 'exit' | 'timeout' | 'disposed' }) => void) => void
  /** 优雅关闭：通知 host close 资源 → 执行 dispose（kill 进程树） */
  dispose: () => void
}

interface PendingCall {
  id: string
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer?: NodeJS.Timeout
  isStream: boolean
}

/** 旧模型：ChildProcess → 传输适配 */
function createProcTransport(proc: ChildProcess, dispose?: () => void): NativeHostTransport {
  return {
    write: (chunk: string) => {
      if (proc.stdin?.writable) proc.stdin.write(chunk)
    },
    end: () => {
      try {
        proc.stdin?.end()
      } catch {
        /* 已关闭忽略 */
      }
    },
    onStdout: (cb) => proc.stdout?.on('data', (chunk: Buffer) => cb(chunk.toString())),
    onExit: (cb) => proc.on('exit', (code) => cb(code)),
    onError: (cb) => proc.on('error', (err) => cb(err)),
    kill: () => {
      if (dispose) {
        try {
          dispose()
        } catch {
          /* 兜底 */
        }
      } else {
        try {
          proc.kill()
        } catch {
          /* 已退出 */
        }
      }
    },
  }
}

/** 宿主代管子进程句柄（@dlient-open/plugin-sdk ChildHandle）的传输适配。结构类型，不 import plugin-sdk。 */
export function createHostedTransport(handle: {
  onStdout(cb: (data: string) => void): void
  onStderr(cb: (data: string) => void): void
  onExit(cb: (info: { code: number | null; signal?: string; reason?: string }) => void): void
  onError(cb: (err: Error) => void): void
  kill(): Promise<void>
  write(chunk: string): Promise<void>
  end(): Promise<void>
}): NativeHostTransport {
  return {
    write: (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      void handle.write(text).catch(() => undefined)
    },
    end: () => {
      void handle.end().catch(() => undefined)
    },
    onStdout: (cb) => handle.onStdout(cb),
    onExit: (cb) =>
      handle.onExit((info) => {
        cb(info.code)
      }),
    onError: (cb) => handle.onError(cb),
    kill: () => handle.kill(),
  }
}

export function createNativeHostClient(options: NativeHostClientOptions): NativeHostClient {
  const {
    transport: transportOpt,
    proc,
    dispose: disposeProc,
    timeoutMs = 30000,
    heartbeatTimeoutMs = 33000,
    ndjson = false,
  } = options
  const transport: NativeHostTransport = (() => {
    const t = transportOpt ?? (proc ? createProcTransport(proc, disposeProc) : undefined)
    if (!t) throw new Error('createNativeHostClient: transport or proc required')
    return t
  })()
  const events = new EventEmitter()
  const exitCallbacks: Array<(info: { code: number | null; reason: 'exit' | 'timeout' | 'disposed' }) => void> = []
  const pending = new Map<string, PendingCall>()
  let seq = 0
  let disposed = false

  // ---- 帧读取（stdout 流 → FrameDecoder；partial 帧由 decoder 缓冲拼接） ----
  const decoder = new FrameDecoder(ndjson, (msg) => {
    lastSeenAt = Date.now()
    const m = msg as HostMessage
    if (m && typeof m === 'object' && 'ping' in m) {
      // host 心跳：回 pong
      write({ pong: (m as { ping: number }).ping })
      return
    }
    if (m && typeof m === 'object' && 'event' in m) {
      const ev = m as { event: string; data?: unknown }
      events.emit(ev.event, ev.data)
      return
    }
    if (m && typeof m === 'object' && 'id' in m) {
      const res = m as { id: string; ok: boolean; result?: unknown; more?: boolean; error?: string }
      const call = pending.get(res.id)
      if (!call) return
      if (call.isStream) {
        if (res.ok && res.more) {
          events.emit(`stream:${res.id}:data`, res.result)
          return
        }
        // 最终包：ok=true → streamDone(result)；ok=false → reject
        pending.delete(res.id)
        if (call.timer) clearTimeout(call.timer)
        if (res.ok) call.resolve(res.result)
        else call.reject(new Error(res.error ?? `native-host RPC failed: ${res.id}`))
        return
      }
      pending.delete(res.id)
      if (call.timer) clearTimeout(call.timer)
      if (res.ok) call.resolve(res.result)
      else call.reject(new Error(res.error ?? `native-host RPC failed: ${res.id}`))
    }
  })

  transport.onStdout((chunk: string) => decoder.push(chunk))

  const write = (msg: ClientMessage): void => {
    if (disposed) return
    transport.write(encodeFrame(msg, ndjson))
  }

  // ---- 崩溃 / 失联统一清理 ----
  const failAll = (reason: 'exit' | 'timeout' | 'disposed', code: number | null, err: Error): void => {
    for (const [, call] of pending) {
      if (call.timer) clearTimeout(call.timer)
      call.reject(err)
    }
    pending.clear()
    for (const cb of exitCallbacks) {
      try {
        cb({ code, reason })
      } catch {
        /* 忽略订阅者异常 */
      }
    }
  }

  transport.onExit((code) => {
    if (disposed) return
    failAll('exit', code, new Error(`原生模块进程异常退出（code=${code ?? 'unknown'}），请重启插件`))
  })
  transport.onError((err) => {
    if (disposed) return
    failAll('exit', null, new Error(`原生模块进程启动失败: ${err.message}`))
  })

  // ---- 心跳失联 watchdog ----
  let lastSeenAt = Date.now()
  const heartbeatTimer = setInterval(() => {
    if (disposed) return
    if (Date.now() - lastSeenAt > heartbeatTimeoutMs) {
      failAll('timeout', null, new Error('原生模块进程心跳超时（失联），请重启插件'))
    }
  }, 5000)

  // ---- RPC ----
  function call<T>(service: string, method: string, params?: unknown[], opts?: { timeoutMs?: number }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (disposed) return reject(new Error('native-host client disposed'))
      const id = `rpc-${++seq}`
      const callRec: PendingCall = { id, resolve: (v) => resolve(v as T), reject, isStream: false }
      const t = opts?.timeoutMs ?? timeoutMs
      if (t > 0) {
        callRec.timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`native-host RPC 超时（${service}.${method} > ${t / 1000}s）`))
        }, t)
      }
      pending.set(id, callRec)
      write({ id, service, method, params } satisfies RpcRequest)
    })
  }

  function stream<T>(service: string, method: string, params?: unknown[]): StreamHandle<T> {
    const id = `stream-${++seq}`
    const dataCbs: Array<(chunk: T) => void> = []
    const doneCbs: Array<(result: T | undefined) => void> = []
    const errorCbs: Array<(err: Error) => void> = []
    const onDataEv = `stream:${id}:data`

    const handle: StreamHandle<T> = {
      onData: (cb) => dataCbs.push(cb),
      onDone: (cb) => doneCbs.push(cb),
      onError: (cb) => errorCbs.push(cb),
      abort: () => {
        pending.delete(id)
        events.removeAllListeners(onDataEv)
      },
    }

    const callRec: PendingCall = {
      id,
      resolve: (result) => {
        for (const cb of doneCbs) {
          try {
            cb(result as T | undefined)
          } catch {
            /* 忽略 */
          }
        }
        events.removeAllListeners(onDataEv)
      },
      reject: (err) => {
        for (const cb of errorCbs) {
          try {
            cb(err)
          } catch {
            /* 忽略 */
          }
        }
        events.removeAllListeners(onDataEv)
      },
      isStream: true,
    }
    pending.set(id, callRec)
    events.on(onDataEv, (chunk: unknown) => {
      for (const cb of dataCbs) {
        try {
          cb(chunk as T)
        } catch {
          /* 忽略 */
        }
      }
    })
    write({ id, service, method, params } satisfies RpcRequest)
    return handle
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    clearInterval(heartbeatTimer)
    failAll('disposed', null, new Error('native-host client disposed'))
    // 通知 host 优雅关闭（DB close / pty end）后回收进程树
    try {
      transport.end?.()
    } catch {
      /* 已关闭忽略 */
    }
    const k = transport.kill()
    if (k && typeof (k as Promise<unknown>).then === 'function') {
      void (k as Promise<unknown>).catch(() => undefined)
    }
  }

  return {
    call,
    stream,
    onEvent: (event, cb) => events.on(event, cb),
    onExit: (cb) => exitCallbacks.push(cb),
    dispose,
  }
}

// ---- 便捷封装：spawn 官方 Node + 客户端 + 环境变量剥离（docs/todo/16-native-host.md §16.8）----
// 仅保留基础 PATH/HOME，剥离 NODE_OPTIONS / ELECTRON_RUN_AS_NODE 等高风险环境变量，
// 防止用户环境注入影响原生模块（如数据库驱动读 SQLITE_TMPDIR）行为异常。

export interface SpawnNativeHostOptions {
  /** 官方 node 可执行路径（nodejs.resolveRuntime 返回的 node） */
  node: string
  /** native-host 入口绝对路径（如 <pluginDir>/dist/native-host.js） */
  entry: string
  /** 工作目录（插件目录，createRequire 从该处 node_modules 解析原生模块） */
  cwd?: string
  /** 进程环境变量（缺省剥离高风险项后的 process.env 子集） */
  env?: Record<string, string | undefined>
  timeoutMs?: number
  heartbeatTimeoutMs?: number
  ndjson?: boolean
}

export interface SpawnedNativeHost {
  proc: ChildProcess
  client: NativeHostClient
}

/** 生成剥离高风险项后的环境变量（仅保留 PATH/HOME 等基础项 + 调用方补充项） */
export function strippedNativeEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { PATH: process.env.PATH, HOME: process.env.HOME }
  if (process.platform === 'win32') {
    env.SystemRoot = process.env.SystemRoot
    env.USERPROFILE = process.env.USERPROFILE
    env.APPDATA = process.env.APPDATA
  }
  return { ...env, ...extra } as NodeJS.ProcessEnv
}

export function spawnNativeHost(options: SpawnNativeHostOptions): SpawnedNativeHost {
  const proc = spawn(options.node, [options.entry], {
    cwd: options.cwd,
    env: strippedNativeEnv(options.env),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const client = createNativeHostClient({
    proc,
    timeoutMs: options.timeoutMs,
    heartbeatTimeoutMs: options.heartbeatTimeoutMs,
    ndjson: options.ndjson,
  })
  return { proc, client }
}

// ---- #17 崩溃自动重启 RPC 层（docs/specs/plugin-permission.md §10 P2）----
// native-host 崩溃（段错误等进程直接退出）→ 自动重启 + 恢复钩子；在途请求由内层 client 拒绝。
// 语义：call() 先 ensure 存活（client 为 null → 重新 spawn，指数退避）；
// 调用中崩溃 → 内层 reject 该次调用（调用方可见），下一次 call 自动重启后续航。
// 主动 stop() / dispose() 不重启。一插件一实例（调用方自持），不跨插件共享。

export interface RestartableNativeHostOptions {
  /** 每次（重新）拉起 host：返回新 client + 释放句柄；抛错视为本次拉起失败（退避重试） */
  spawn: () => Promise<{ client: NativeHostClient; dispose?: () => void }>
  /** 新 host 就绪后的恢复（如 sqlite init db 目录）；抛错视为恢复失败 → 杀进程 + 退避重试 */
  onRestarted?: (client: NativeHostClient) => Promise<void>
  /** 初退避 ms（默认 300）；最大退避 ms（默认 8000） */
  backoffMs?: number
  maxBackoffMs?: number
  /** 连续失败最大重试次数（默认 10；超限置 dead 并 onExit(reason:'dead')） */
  maxRestarts?: number
}

export interface RestartableNativeHost {
  /** 普通 RPC：先 ensure 存活（崩溃自动重启），再转发 */
  call: <T = unknown>(service: string, method: string, params?: unknown[], opts?: { timeoutMs?: number }) => Promise<T>
  /** host 退出/失联/置死回调（reason: 'exit' | 'timeout' | 'disposed' | 'dead'） */
  onExit: (cb: (info: { code: number | null; reason: string }) => void) => void
  /** 主动停止：不再自动重启，回收当前 host */
  stop: () => Promise<void>
}

export function createRestartableNativeHost(options: RestartableNativeHostOptions): RestartableNativeHost {
  const { backoffMs = 300, maxBackoffMs = 8000, maxRestarts = 10 } = options
  let client: NativeHostClient | null = null
  let disposeCur: (() => void) | undefined
  let spawning: Promise<boolean> | null = null
  let stopped = false
  let dead = false
  let fails = 0
  const exitCbs: Array<(info: { code: number | null; reason: string }) => void> = []
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  const fireExit = (info: { code: number | null; reason: string }): void => {
    for (const cb of exitCbs) {
      try {
        cb(info)
      } catch {
        /* 忽略订阅者异常 */
      }
    }
  }

  async function doSpawn(): Promise<boolean> {
    if (stopped || dead) return false
    try {
      const s = await options.spawn()
      if (stopped || dead) {
        s.dispose?.()
        return false
      }
      if (options.onRestarted) await options.onRestarted(s.client)
      client = s.client
      disposeCur = s.dispose
      fails = 0
      s.client.onExit((info) => {
        client = null
        disposeCur = undefined
        if (stopped) return
        // 崩/失联：通知调用方（在途已由内层 reject）；后续 call 经 ensure 自动重启
        fireExit({ code: info.code, reason: info.reason === 'disposed' ? 'disposed' : info.reason === 'timeout' ? 'timeout' : 'exit' })
      })
      return true
    } catch (err) {
      fails += 1
      if (stopped || fails > maxRestarts) {
        dead = true
        fireExit({ code: null, reason: 'dead' })
        return false
      }
      const wait = Math.min(backoffMs * 2 ** Math.min(fails - 1, 8), maxBackoffMs)
      await sleep(wait)
      return doSpawn()
    }
  }

  const ensure = async (): Promise<NativeHostClient> => {
    if (client) return client
    if (stopped) throw new Error('native-host 已停止')
    if (dead) throw new Error('native-host 多次启动失败，请重启插件')
    if (!spawning) spawning = doSpawn()
    const ok = await spawning
    spawning = null
    if (!ok || !client) throw new Error('native-host 不可用')
    return client
  }

  return {
    call: async (service, method, params, opts) => {
      const c = await ensure()
      return c.call(service, method, params, opts)
    },
    onExit: (cb) => exitCbs.push(cb),
    stop: async () => {
      stopped = true
      const d = disposeCur
      const c = client
      client = null
      disposeCur = undefined
      // 优雅关闭（内层 dispose：stdin EOF → host onClose → kill）
      try {
        c?.dispose()
      } catch {
        /* 忽略 */
      }
      if (d && d !== c?.dispose) {
        try {
          await d()
        } catch {
          /* 忽略 */
        }
      }
    },
  }
}
