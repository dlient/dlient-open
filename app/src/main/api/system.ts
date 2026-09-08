/**
 * api/system.ts - system 模块 host-api 定义。
 * 迁移自 export.ts 的 hostApiMethods（system.getIdleState / nativeTheme.system）。
 */
import { powerMonitor } from 'electron'
import type { ApiDefinition } from './types'
import { useSystemNativeTheme } from '../lib/theme'

export const systemApis: ApiDefinition[] = [
  {
    key: 'system.getIdleState',
    description: {
      'zh-CN': '获取系统空闲状态',
      'en-US': 'Get system idle state',
    },
    scope: 'worker',
    level: 'default',
    handler: ([threshold]) => powerMonitor.getSystemIdleState(Number(threshold ?? 5)),
  },
  {
    key: 'system.listenNativeTheme',
    description: {
      'zh-CN': '开启/关闭系统主题跟随（OS 主题变化自动转发渲染层）',
      'en-US': 'Toggle OS theme following (OS theme changes forwarded to renderer)',
    },
    scope: 'worker',
    level: 'default',
    handler: ([flag]) => useSystemNativeTheme(flag === true),
  },
]
