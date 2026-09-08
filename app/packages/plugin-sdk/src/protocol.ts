/**
 * 主进程 ⇄ worker 控制面消息协议（经 utilityProcess postMessage）。
 * 渲染层不直接连 worker：request/onEvent 经主进程 bridge 转发为 rpc-call / push。
 * 自 core 迁入，core 反向引用本包。
 */

export interface InitMessage {
  type: 'init'
  pluginId: string
  version: string
  generation: number
}

export interface ReadyMessage {
  type: 'ready'
  pluginId: string
  capabilities: string[]
}

export interface RpcCallMessage {
  type: 'rpc-call'
  id: string
  method: string
  args: unknown[]
  pluginId: string
  /**
   * 调用方插件 id（跨插件 invoke 时由主进程填入；渲染层直连不经过此通道）。
   * worker 端 handler 据此识别请求方身份，实现多租户隔离。
   */
  from_plugin_id?: string
}

export interface RpcResponseMessage {
  type: 'rpc-response'
  id: string
  result?: unknown
  error?: string
  /** 结构化错误码（数值，DlientErrorCode；成功或缺省时省略） */
  error_code?: number
  pluginId: string
}

/** worker → 主进程的宿主能力调用 */
export interface HostApiCallMessage {
  type: 'host-api-call'
  id: string
  method: string
  args: unknown[]
  pluginId: string
}

export interface HostApiResponseMessage {
  type: 'host-api-response'
  id: string
  result?: unknown
  error?: string
  /** 结构化错误码（数值，DlientErrorCode；成功或缺省时省略） */
  error_code?: number
}

/** worker → 渲染层的主动推送（经主进程 bridge 分发到订阅 view） */
export interface PushMessage {
  type: 'push'
  pluginId: string
  event: string
  data?: unknown
}

/** 双向存活心跳：worker → 主进程 与 主进程 → worker 各每 10s 一次，对端据此判定本方失联（常驻任务不占用 RPC 通道） */
export interface HeartbeatMessage {
  type: 'heartbeat'
  pluginId: string
  ts: number
}

export interface ErrorMessage {
  type: 'error'
  pluginId: string
  message: string
  code?: string
}

export interface LogMessage {
  type: 'log'
  pluginId: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: unknown
}

/**
 * 直连 port（MessageChannelMain）消息 —— preload ⇄ worker directPort。
 * request/listen 由 preload 发出；cancel/response/error/stream 由对端回传。
 * data 为可选大块数据（ArrayBuffer），发送时经 transfer list 零拷贝转移。
 */

/** 渲染层 → worker：单响应请求 */
export interface DirectRequestMessage {
  type: 'request'
  request_id: string
  from_plugin_id: string
  method: string
  args: unknown[]
  data?: ArrayBuffer
}

/** 渲染层 → worker：流式请求 */
export interface DirectListenMessage {
  type: 'listen'
  request_id: string
  from_plugin_id: string
  method: string
  args: unknown[]
  data?: ArrayBuffer
}

/** 渲染层 → worker：取消流式请求（UI 取消监听时发出） */
export interface DirectCancelMessage {
  type: 'cancel'
  request_id: string
}

/** worker → 渲染层：request 响应 */
export interface DirectResponseMessage {
  type: 'response'
  request_id: string
  result?: unknown
  data?: ArrayBuffer
}

/** worker → 渲染层：请求失败（request / listen 共用） */
export interface DirectErrorMessage {
  type: 'error'
  request_id: string
  error: string
  /** 结构化错误码（数值，DlientErrorCode；未知时 INTERNAL） */
  error_code?: number
  /** 失败信封（SDK 兜底包装的 { code, msg, data: null, from }）；渲染层优先透传该值 */
  result?: unknown
}

/** worker → 渲染层：流式块 */
export interface DirectStreamMessage {
  type: 'stream'
  request_id: string
  chunk?: unknown
  data?: ArrayBuffer
}

/** worker → 渲染层：流式结束 */
export interface DirectStreamDoneMessage {
  type: 'stream-done'
  request_id: string
  result?: unknown
}

/** worker → 渲染层：流式失败 */
export interface DirectStreamErrorMessage {
  type: 'stream-error'
  request_id: string
  error: string
  /** 结构化错误码（数值，DlientErrorCode；未知时 INTERNAL） */
  error_code?: number
}

export type DirectPortMessage =
  | DirectRequestMessage
  | DirectListenMessage
  | DirectCancelMessage
  | DirectResponseMessage
  | DirectErrorMessage
  | DirectStreamMessage
  | DirectStreamDoneMessage
  | DirectStreamErrorMessage

/** 主进程 → worker：下发 direct port（port 位于消息的 ports 中） */
export interface PortSetupMessage {
  type: 'port-setup'
  pluginId: string
}

/** worker → 主进程：directPort 已设置完成，主进程据此下发 port1 给渲染层 */
export interface DirectPortReadyMessage {
  type: 'direct-port-ready'
  pluginId: string
}

/** 主进程 → worker：请求业务状态快照（热重载/重启前；1s 窗口内回 snapshot-response，超时按无快照处理） */
export interface SnapshotRequestMessage {
  type: 'snapshot-request'
  pluginId: string
  request_id: string
}

/** worker → 主进程：快照响应（未注册快照 handler 或超时不回） */
export interface SnapshotResponseMessage {
  type: 'snapshot-response'
  pluginId: string
  request_id: string
  snapshot?: unknown
  error?: string
  error_code?: number
}

/** 主进程 → worker：恢复业务状态快照（重启后新 worker 回灌，消息保序保证先于后续调用） */
export interface SnapshotRestoreMessage {
  type: 'snapshot-restore'
  pluginId: string
  snapshot: unknown
}

/** 宿主 → worker：请求逆序执行 rpc.effect 注册的 disposables（停止前优雅清理；完成回复 dispose-done） */
export interface DisposeMessage {
  type: 'dispose'
  pluginId: string
}

/** worker → 宿主：disposables 清理完成 */
export interface DisposeDoneMessage {
  type: 'dispose-done'
  pluginId: string
}

/** 宿主 → worker：宿主代管子进程事件（child.spawn 流式输出/退出，child-event） */
export interface ChildEventMessage {
  type: 'child-event'
  child: {
    handleId: string
    event: 'stdout' | 'stderr' | 'exit' | 'error'
    data?: string
    code?: number | null
    signal?: string | null
  }
}

/**
 * worker → 宿主：child 句柄控制（句柄内聚 §6.4：kill/stdin 不再走 host-api，经本通道定向到句柄属主）。
 * op：kill=树杀 + 注销；write=写 stdin；end=结束 stdin。
 */
export interface ChildControlMessage {
  type: 'child-control'
  id: string
  pluginId: string
  handleId: string
  op: 'kill' | 'write' | 'end'
  data?: string
}

/** 宿主 → worker：child 句柄控制结果 */
export interface ChildControlResponseMessage {
  type: 'child-control-response'
  id: string
  ok: boolean
  reason?: string
}

/** worker → 宿主：订阅 child 句柄事件（订阅后宿主回放缓冲事件 + 实时流；消除 spawn 返回前的注册竞态） */
export interface ChildSubscribeMessage {
  type: 'child-subscribe'
  pluginId: string
  handleId: string
}

/** 宿主 → worker：notification 句柄事件（notification-event，按 id 分发到句柄回调） */
export interface NotificationEventMessage {
  type: 'notification-event'
  id: string
  event: 'click' | 'close' | 'reply' | 'action' | 'failed' | 'show'
  payload?: { index?: number; reply?: string; error?: string }
}

export type PluginMessage =
  | InitMessage
  | ReadyMessage
  | RpcCallMessage
  | RpcResponseMessage
  | HostApiCallMessage
  | HostApiResponseMessage
  | PushMessage
  | HeartbeatMessage
  | ErrorMessage
  | LogMessage
  | PortSetupMessage
  | DirectPortReadyMessage
  | SnapshotRequestMessage
  | SnapshotResponseMessage
  | SnapshotRestoreMessage
  | DisposeMessage
  | DisposeDoneMessage
  | ChildEventMessage
  | ChildControlMessage
  | ChildControlResponseMessage
  | ChildSubscribeMessage
  | NotificationEventMessage
