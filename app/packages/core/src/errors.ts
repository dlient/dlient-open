/**
 * 统一结构化错误码（真源，dlient 全部调用链共用）。
 *
 * 跨层约定：
 *  - 主进程（core / runtime / export / bridge）从这里引用；
 *  - @dlient-open/plugin-sdk（worker 端）、@dlient-open/api-bridge（渲染层）、preload 为「不引入 node/渲染依赖」
 *    各自内联一份同值常量（改动本文件时须同步，见各文件注释）；
 *  - 错误以 DlientError 抛出，经协议透传 error_code 字段；渲染层统一经 getErrorCode(err) 提取。
 *
 * 数值段：
 *  - -1001 ~ -1005：调用授权/编排（兼容历史 CALL_ERR）
 *  - -2001 ~ -2005：调用前校验（PluginManager.canInvoke）
 *  - -2101 ~ -2107：执行 / 传输层
 *  - -2200：兜底内部错误
 */

/** 调用错误码（数值；0 = 成功） */
export const DlientErrorCode = {
  OK: 0,

  // ---- 调用授权 / 编排（兼容历史 CALL_ERR）----
  /** 目标插件未安装且不可安装（如不在市场） */
  NOT_INSTALLED: -1001,
  /** 目标插件安装失败（附原因） */
  INSTALL_FAILED: -1002,
  /** 用户拒绝授权（含确认超时） */
  USER_DENIED: -1003,
  /** 用户确认超时 */
  TIMEOUT: -1004,
  /** 授权记录无效 / 其它拒绝（历史 CALL_ERR.INVALID） */
  INVALID: -1005,
  /** 用户取消文件/目录选择（dialog.showOpenDialog 授权流程专用） */
  DIALOG_CANCELED: -1006,

  // ---- 调用前校验（PluginManager.canInvoke）----
  /** 目标插件未加载（controller 缺失） */
  TARGET_NOT_FOUND: -2001,
  /** 目标插件未在 manifest.expose 声明该方法 */
  METHOD_NOT_EXPOSED: -2002,
  /** runtime-confirm 档且无有效授权（可走 §7 运行时确认） */
  NEED_RUNTIME_CONFIRM: -2003,
  /** install-confirm 档且无授权（安装流程已确认后写授权） */
  NEED_INSTALL_CONFIRM: -2004,
  /** 其它档位不匹配（private/default/system） */
  ACCESS_DENIED: -2005,

  // ---- 执行 / 传输层 ----
  /** worker 端未注册该 handler（与 METHOD_NOT_EXPOSED 区分：声明了 expose 但未实现） */
  METHOD_NOT_REGISTERED: -2101,
  /** 目标插件 worker 未运行 / 失联 */
  WORKER_NOT_RUNNING: -2102,
  /** 渲染层直连端口未就绪（超时） */
  PORT_NOT_READY: -2103,
  /** 渲染层请求验签失败 */
  INVALID_SIGNATURE: -2104,
  /** 渲染层视图未登记（setView 缺失）或插件不匹配 */
  VIEW_NOT_REGISTERED: -2105,
  /** 宿主能力不存在 */
  HOST_API_NOT_FOUND: -2106,
  /** 宿主能力权限不足（manifest.permissions 未声明） */
  PERMISSION_DENIED: -2107,

  // ---- 兜底 ----
  /** 未分类内部错误 */
  INTERNAL: -2200,
} as const

export type DlientErrorCode = (typeof DlientErrorCode)[keyof typeof DlientErrorCode]

/** 从错误 message 解析 `[ERR -xxxx]` 前缀（跨进程/跨桥丢字段时的兜底） */
export function parseErrCodeFromMessage(message: string): DlientErrorCode | undefined {
  const m = /\[ERR\s*(-?\d+)\]/.exec(message ?? '')
  if (m && m[1] !== undefined) return Number(m[1]) as DlientErrorCode
  return undefined
}

/** 从任意错误提取错误码：优先 code 字段（DlientError / {code:number}），其次 message 前缀，最后 INTERNAL */
export function getErrorCode(err: unknown): DlientErrorCode {
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'number') {
    return (err as { code: number }).code as DlientErrorCode
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return parseErrCodeFromMessage(message) ?? DlientErrorCode.INTERNAL
}

/** 结构化错误：统一携带 code（数值）+ message（人类可读）+ detail（可选上下文） */
export class DlientError extends Error {
  readonly code: DlientErrorCode
  readonly detail?: unknown

  constructor(code: DlientErrorCode, message: string, detail?: unknown) {
    super(message)
    this.name = 'DlientError'
    this.code = code
    this.detail = detail
  }
}

/** 归一任意错误为 DlientError（保留已有 code；无码归 INTERNAL） */
export function toDlientError(err: unknown, fallbackMessage?: string): DlientError {
  if (err instanceof DlientError) return err
  if (err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'number') {
    const e = err as { code: number; message?: unknown; detail?: unknown }
    return new DlientError(
      e.code as DlientErrorCode,
      typeof e.message === 'string' ? e.message : (fallbackMessage ?? 'Dlient error'),
      e.detail,
    )
  }
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : (fallbackMessage ?? String(err ?? 'Dlient error'))
  return new DlientError(parseErrCodeFromMessage(message) ?? DlientErrorCode.INTERNAL, message)
}
