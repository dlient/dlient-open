/**
 * native-host 通信协议层（docs/todo/16-native-host.md §16.5）。
 *
 * 默认 **length-prefixed JSON**：每条消息 = 4 字节大端长度头 + JSON 载荷。
 * 对二进制/大数据（终端输出、图片 Buffer）比 NDJSON 更健壮（无按行解析边界问题，
 * 无 Base64 33% 膨胀）；调试场景可用 NDJSON（换行分隔）。
 *
 * 消息类型（同通道区分）：
 *   - 请求（client → host）：  { id, service, method, params }
 *   - 响应（host → client）：   { id, ok:true, result } | { id, ok:false, error }
 *   - 流式分块：                { id, ok:true, result, more:true } … { id, ok:true, result }（缺省 more=false 为最终包）
 *   - 事件推送（host → client）：{ event, data }
 *   - 心跳：                    host → client { ping, ts }；client → host { pong, ts }
 *
 * 本模块为纯 Node（仅 node:*），native-host 子进程与 worker 侧客户端共用同一套帧编解码。
 */

export interface RpcRequest {
  id: string
  service: string
  method: string
  params?: unknown[]
}

export interface RpcResponse {
  id: string
  ok: boolean
  result?: unknown
  /** 流式中间包为 true；缺省 / false = 最终响应 */
  more?: boolean
  error?: string
}

export interface RpcEvent {
  event: string
  data?: unknown
}

export interface RpcPing {
  ping: number
}

export interface RpcPong {
  pong: number
}

export type HostMessage = RpcResponse | RpcEvent | RpcPing
export type ClientMessage = RpcRequest | RpcPong

/** 编码为传输帧：length-prefixed（4B 大端长度头 + UTF-8 JSON）或 NDJSON（换行分隔） */
export function encodeFrame(msg: ClientMessage | HostMessage, ndjson = false): Buffer {
  const json = Buffer.from(JSON.stringify(msg), 'utf-8')
  if (ndjson) return Buffer.concat([json, Buffer.from('\n', 'utf-8')])
  const head = Buffer.alloc(4)
  head.writeUInt32BE(json.length, 0)
  return Buffer.concat([head, json])
}

/**
 * 流式帧解码器：向 push() 喂入原始字节块，解析出完整 JSON 消息回调 onMessage。
 * 无内部缓冲上限保护（消息大小受 JSON 载荷约束，调用方控制）。
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)
  private readonly ndjson: boolean

  constructor(
    ndjson: boolean,
    private readonly onMessage: (msg: ClientMessage | HostMessage) => void,
  ) {
    this.ndjson = ndjson
  }

  /** 喂入原始字节/字符串块（宿主代管传输按 chunk 粒度推送字符串，可能跨帧/拆帧，内部缓冲拼接） */
  push(chunk: Buffer | string): void {
    const data = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    this.buffer = this.buffer.length === 0 ? data : Buffer.concat([this.buffer, data])
    if (this.ndjson) {
      let idx: number
      while ((idx = this.buffer.indexOf(0x0a)) >= 0) {
        const line = this.buffer.subarray(0, idx).toString('utf-8').trim()
        this.buffer = this.buffer.subarray(idx + 1)
        if (line) this.tryParse(line)
      }
      return
    }
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0)
      if (this.buffer.length < 4 + len) break
      const body = this.buffer.subarray(4, 4 + len).toString('utf-8')
      this.buffer = this.buffer.subarray(4 + len)
      this.tryParse(body)
    }
  }

  private tryParse(json: string): void {
    try {
      const msg = JSON.parse(json) as ClientMessage | HostMessage
      this.onMessage(msg)
    } catch {
      /* 帧损坏：跳过（日志由调用方负责） */
    }
  }
}
