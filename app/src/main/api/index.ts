/**
 * api/index.ts - host-api 定义注册表（api 目录为「方法定义 + 权限声明 + 能力展示」单一数据源）。
 * 详见 docs/specs/host-api-v2.md。
 * 迁移完成：所有条目均带真实 handler（简单 API 内联；复杂 API 引 lib/ 方法）。
 */
import type { ApiDefinition } from './types'
import { registerPluginCapabilityProvider } from '../lib/plugin'
import { systemApis } from './system'
import { appApis, appExtraApis } from './app'
import { i18nApis } from './i18n'
import { netApis } from './net'
import { osApis } from './os'
import { dialogApis } from './dialog'
import { clipboardApis } from './clipboard'
import { notificationApis } from './notification'
import { powerSaveApis } from './power-save'
import { screenApis } from './screen'
import { fsApis } from './fs'
import { pluginApis } from './plugin'
import { permissionApis } from './permission'
import { childApis } from './child'
import { webviewApis } from './webview'
import { logApis } from './log'
import { nodejsApis } from './nodejs'

const rawApis: ApiDefinition[] = [
  ...appApis,
  ...appExtraApis,
  ...systemApis,
  ...i18nApis,
  ...netApis,
  ...osApis,
  ...dialogApis,
  ...clipboardApis,
  ...notificationApis,
  ...powerSaveApis,
  ...screenApis,
  ...fsApis,
  ...pluginApis,
  ...permissionApis,
  ...childApis,
  ...webviewApis,
  ...logApis,
  ...nodejsApis,
]

/** 全部 host-api 定义（模块顺序即展示顺序；handler 恒非空） */
export const allApis: ApiDefinition[] = rawApis

/** 按 key 查询 */
export function getApi(key: string): ApiDefinition | undefined {
  return allApis.find((a) => a.key === key)
}

/** 全部 key 列表 */
export function listApiKeys(): string[] {
  return allApis.map((a) => a.key)
}

// plugin.capabilities（原 host.capabilities.list）：返回 api 目录全量元数据（plugin 模块 handler 经此取数）
registerPluginCapabilityProvider(() =>
  allApis.map((a) => ({ key: a.key, description: a.description, scope: a.scope, level: a.level })),
)
