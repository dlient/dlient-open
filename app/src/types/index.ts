// 主进程与渲染层共享类型

import type { PluginSource, PluginType } from '@dlient-open/core'

export type Locale = 'zh-CN' | 'en-US'

/** 插件安装记录（plugins.json 条目） */
export interface PluginRecord {
  id: string
  name: string
  version: string
  enabled: boolean
  source: PluginSource
  type: PluginType
  /** 是否为系统级插件（不可卸载；首次启动从服务器下载安装） */
  system?: boolean
  /** 图标：相对插件根目录路径字符串（svg/png） */
  icon?: string
  /** 插件所属组织（'@xxx'；宿主 resolveOrg 判定后填充，缺省 undefined = 无组织，org 层禁用） */
  organization?: string
  path: string
  installedAt: number
  lastUsedAt?: number
}

/** 解析 manifest 图标：仅接受字符串路径；非字符串返回 undefined */
export function parseManifestIcon(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

export type Theme = 'light' | 'dark' | 'system'
