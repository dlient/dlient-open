/**
 * log host-api — typed single source.
 * Real source of truth: app/src/main/api/log.ts (handler reads these fields).
 * 声明 manifest.permissions 的 log（前缀组，覆盖 log.*）即可写入自身插件日志，无需 fs 权限。
 */

export interface LogModuleApi {
  /**
   * 写入插件日志（source 由宿主按调用方身份推导：worker→'worker' / ui→'renderer'）。
   * 落 plugin-data/<pluginId>/logs/main.log（含轮转与订阅推送）；未声明 log 权限则拒绝。
   */
  'log.write'(level?: 'debug' | 'info' | 'warn' | 'error', message?: string, data?: unknown): Promise<{ ok: boolean }>
}
