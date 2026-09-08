/**
 * api/os.ts - os 模块 host-api（外部打开；scope=system 仅 system 插件可用）。
 */
import { shell } from 'electron'
import type { ApiDefinition } from './types'

export const osApis: ApiDefinition[] = [
  {
    key: 'os.openExternal',
    description: { 'zh-CN': '用系统默认程序打开外部链接', 'en-US': 'Open external URL with system default app' },
    scope: 'system',
    level: 'dangerous',
    handler: ([url]) => shell.openExternal(String(url)),
  },
  {
    key: 'os.showItemInFolder',
    description: { 'zh-CN': '在资源管理器中显示文件/目录', 'en-US': 'Reveal file/dir in system file manager' },
    scope: 'system',
    level: 'warn',
    handler: ([path]) => shell.showItemInFolder(String(path)),
  },
]
