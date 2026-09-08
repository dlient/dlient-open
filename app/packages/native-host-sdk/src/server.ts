/**
 * native-host 服务端（docs/todo/16-native-host.md §16.5）。
 * 纯 Node 子进程（官方 Node 运行）内启动：注册 service 处理器，经 stdin/stdout 提供
 * length-prefixed JSON-RPC。支持：
 *   - service 注册表：better-sqlite3 / node-pty 等作为不同 service 注册到同一 host 进程，
 *     worker 按 { service, method, params } 路由，避免每原生能力各起一个 Node 进程；
 *   - 流式分块：handler 返回 AsyncIterable 或调用 ctx.emit(chunk) → { id, result, more:true } 增量传输；
 *   - 双向事件：host.emit(event, data) 推送给 worker（如 pty 输出 / DB 变更通知）；
 *   - 心跳：每 heartbeatMs 发 { ping }，worker 侧超时未回 pong 判定失联；
 *   - 优雅关闭：close() 先执行各 service 的 onClose（DB close / pty end）再退出；
 *     stdin 结束（worker kill 或写入端关闭）即退出兜底。
 */

import { encodeFrame, FrameDecoder, type ClientMessage, type HostMessage } from './protocol'

export type ServiceHandler = (
  params: unknown[] | undefined,
  ctx: ServiceContext,
) => unknown | Promise<unknown> | AsyncIterable<unknown>

export interface ServiceContext {
  id: string
  service: string
  method: string
  /** 流式发射：多次调用发 { id, result, more:true }，return 后发最终包（缺省 more） */
  emit: (chunk: unknown) => void
}

export interface NativeHostServerOptions {
  input?: NodeJS.ReadableStream
  output?: NodeJS.WritableStream
  /** 调试用 NDJSON 帧（默认 false = length-prefixed JSON） */
  ndjson?: boolean
  /** 心跳间隔 ms（默认 10000） */
  heartbeatMs?: number
}

export interface NativeHostServer {
  /** 注册 service 处理器；同名重复注册覆盖 */
  registerService: (name: string, handlers: Record<string, ServiceHandler>, onClose?: () => unknown | Promise<unknown>) => void
  /** 事件推送：host → worker（如 pty 输出 / DB 变更通知） */
  emit: (event: string, data?: unknown) => void
  /** 优雅关闭：先执行 service onClose（DB close / pty end），再 flush 并退出 */
  close: () => Promise<void>
  /** 由官方 Node 运行时的入口：解析 --ndjson 并启动 */
  readonly started: boolean
}

export function createNativeHostServer(options?: NativeHostServerOptions): NativeHostServer {
  const input = options?.input ?? process.stdin
  const output = options?.output ?? process.stdout
  const ndjson = options?.ndjson ?? process.argv.includes('--ndjson')
  const heartbeatMs = options?.heartbeatMs ?? 10000

  const services = new Map<string, { handlers: Record<string, ServiceHandler>; onClose?: () => unknown | Promise<unknown> }>()
  const closes: Array<() => unknown | Promise<unknown>> = []
  let closed = false

  const send = (msg: HostMessage): void => {
    if (closed || !output.writable) return
    output.write(encodeFrame(msg, ndjson))
  }

  // 请求处理：{ id, service, method, params }
  const handleRequest = async (req: ClientMessage & { id: string }): Promise<void> => {
    if (!('service' in req) || !('method' in req)) return
    const svc = services.get(req.service)
    const id = req.id
    if (!svc) {
      send({ id, ok: false, error: `service not registered: ${req.service}` })
      return
    }
    const handler = svc.handlers[req.method]
    if (!handler) {
      send({ id, ok: false, error: `method not found: ${req.service}.${req.method}` })
      return
    }
    const ctx: ServiceContext = {
      id,
      service: req.service,
      method: req.method,
      emit: (chunk: unknown) => send({ id, ok: true, result: chunk, more: true }),
    }
    try {
      const result = handler(req.params, ctx)
      if (result && typeof (result as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function') {
        // 流式 handler：AsyncIterable → 逐块 more:true，结束发最终包
        for await (const chunk of result as AsyncIterable<unknown>) {
          if (closed) return
          ctx.emit(chunk)
        }
        send({ id, ok: true, result: undefined })
      } else {
        const value = await result
        if (!closed) send({ id, ok: true, result: value })
      }
    } catch (err) {
      send({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  const decoder = new FrameDecoder(ndjson, (msg) => {
    if (msg && typeof msg === 'object' && 'pong' in msg) return // 心跳回执忽略
    if (msg && typeof msg === 'object' && 'id' in msg) {
      void handleRequest(msg as ClientMessage & { id: string })
    }
  })

  const onData = (chunk: Buffer | string): void => {
    decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf-8'))
  }
  input.on('data', onData)

  // stdin 结束（worker kill / 写入端关闭）→ 兜底退出
  const onEnd = (): void => {
    if (!closed) void close().catch(() => process.exit(0))
  }
  input.on('end', onEnd)
  input.on('close', onEnd)

  // 心跳：host 每 heartbeatMs 发 { ping }，worker 超时未回 pong 判定失联
  const heartbeat = setInterval(() => send({ ping: Date.now() }), heartbeatMs)

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    for (const fn of closes) {
      try {
        await fn()
      } catch {
        /* 单个 service 关闭失败不阻塞整体退出 */
      }
    }
    try {
      output.end()
    } catch {
      /* stdout 已关闭忽略 */
    }
  }

  // 未消费 data 事件会触发 'data' 但读流默认暂停；启动后主动 resume 以便持续接收
  ;(input as NodeJS.ReadableStream).resume?.()

  return {
    registerService: (name, handlers, onClose) => {
      services.set(name, { handlers, onClose })
      if (onClose) closes.push(onClose)
    },
    emit: (event, data) => send({ event, data }),
    close,
    started: true,
  }
}

// ---- 便捷入口：官方 Node 直接运行 dist/native-host.js 时使用 ----
// 用法：registerService(...) 后调用 serve()；需 --ndjson 时由 createNativeHostServer 自动识别。
export function serve(): NativeHostServer {
  // 允许插件入口以顶层 await 方式直接使用：node native-host.js
  return createNativeHostServer()
}

// ---- Node REPL 兜底：进程级 stdin 保持存活 ----
// native-host 由 worker spawn，stdin/stdout 均为 pipe；此文件被 ESM 引入时无需额外处理。
