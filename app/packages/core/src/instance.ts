/**
 * instance.ts - 插件实例（instanceKey）标识工具。
 *
 * instanceKey 是插件运行时的隔离键：正式实例 = pluginId，dev 实例 = pluginId@dev。
 * 同一逻辑插件可同时存在正式 + dev 两个实例（双版本并存），worker 池 / 控制器 /
 * 视图签名 / 协议 URL 均按 instanceKey 隔离；插件 worker 内部逻辑 id 仍是 manifest.id。
 */

import type { PluginSource } from '@dlient-open/plugin-sdk'

/** 实例标识：正式 = 'pluginA'，dev = 'pluginA@dev' */
export type InstanceKey = string

const DEV_SUFFIX = '@dev'

/**
 * 由插件逻辑 id + 来源派生实例键。
 * devInstance 为 true 时 dev 来源 → '<id>@dev'（双版本并存）；否则一律 '<id>'。
 * 已启用（install/controller 均传 true）：dev 插件以 '<id>@dev' 独立实例运行，
 * 与正式实例 '<id>' 并存（worker id 映射经 SDK activePluginId 感知 instanceKey）。
 */
export function instanceKeyFor(pluginId: string, source?: PluginSource, devInstance = false): InstanceKey {
  return devInstance && source === 'dev' ? `${pluginId}${DEV_SUFFIX}` : pluginId
}

/** 该实例是否为 dev 实例 */
export function isDevInstance(instanceKey: InstanceKey): boolean {
  return instanceKey.endsWith(DEV_SUFFIX)
}

/** 由实例键还原插件逻辑 id（'pluginA@dev' → 'pluginA'；正式实例原样返回） */
export function basePluginId(instanceKey: InstanceKey): string {
  return isDevInstance(instanceKey) ? instanceKey.slice(0, -DEV_SUFFIX.length) : instanceKey
}
