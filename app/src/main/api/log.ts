/**
 * api/log.ts - log 模块 host-api（dedicated log API）。
 * 语义：插件声明 manifest.permissions 的 log（前缀组，覆盖 log.*）即可写入自身插件日志，
 * 无需声明任何 fs 权限；宿主按调用方身份（worker 反查 / UI view 身份）定位插件，
 * 落 `plugin-data/<pluginId>/logs/main.log`（复用 appendPluginLog：文件锁 / 轮转 / 订阅推送）。
 */
import type { ApiDefinition } from './types'
import { appendPluginLog, formatPluginLogLine } from '../lib/log'

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error'])

export const logApis: ApiDefinition[] = [
  {
    key: 'log.write',
    description: {
      'zh-CN': '写入插件日志（声明 log 权限即可，无需 fs 权限；按调用方身份落 plugin-data/<id>/logs）',
      'en-US': 'Write plugin log (declare log permission; no fs permission needed; written to plugin-data/<id>/logs by caller identity)',
    },
    scope: 'all',
    level: 'default',
    handler: async ([level, message, data], ctx) => {
      const raw = String(level ?? 'info')
      const lv = LOG_LEVELS.has(raw) ? raw : 'info'
      const line = formatPluginLogLine(lv, ctx.channel === 'ui' ? 'renderer' : 'worker', String(message ?? ''), data)
      await appendPluginLog(ctx.pluginId, line)
      return { ok: true }
    },
  },
]
