/**
 * api/power-save.ts - powerSaveBlocker 模块 host-api（scope=worker，UI 直连不开放）。
 */
import { powerSaveBlocker } from 'electron'
import type { ApiDefinition } from './types'

export const powerSaveApis: ApiDefinition[] = [
  {
    key: 'powerSaveBlocker.start',
    description: { 'zh-CN': '阻止系统休眠/熄屏', 'en-US': 'Prevent system sleep / display sleep' },
    scope: 'worker',
    level: 'warn',
    handler: ([type]) => powerSaveBlocker.start(String(type) as 'prevent-app-suspension' | 'prevent-display-sleep'),
  },
  {
    key: 'powerSaveBlocker.stop',
    description: { 'zh-CN': '停止指定阻止器', 'en-US': 'Stop blocker by id' },
    scope: 'worker',
    level: 'warn',
    handler: ([id]) => powerSaveBlocker.stop(Number(id)),
  },
  {
    key: 'powerSaveBlocker.isStarted',
    description: { 'zh-CN': '阻止器是否已启动', 'en-US': 'Check blocker started' },
    scope: 'worker',
    level: 'warn',
    handler: ([id]) => powerSaveBlocker.isStarted(Number(id)),
  },
]
