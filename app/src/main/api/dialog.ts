/**
 * api/dialog.ts - dialog 模块 host-api（一律异步，禁用 *Sync 变体；window 参数不可序列化，省略，仅传 options）。
 * showOpenDialog 选路径 + 资源级授权（fs-access → fs-grants）；showSaveDialog 主动保存写 temp-grant。
 */
import { dialog } from 'electron'
import { DlientError, DlientErrorCode } from '@dlient-open/core'
import type { ApiDefinition } from './types'
import { authorizeFsAccess, getGrantHooks } from '../lib/grants'
import { resolveRealSafe } from '../resource-grants'

export const dialogApis: ApiDefinition[] = [
  {
    key: 'dialog.showMessageBox',
    description: { 'zh-CN': '显示原生消息框', 'en-US': 'Show native message box' },
    scope: 'all',
    level: 'default',
    handler: async ([options]) => dialog.showMessageBox((options ?? {}) as Electron.MessageBoxOptions),
  },
  {
    key: 'dialog.showOpenDialog',
    description: { 'zh-CN': '打开/选目录（含 fs 授权）', 'en-US': 'Open dialog (with fs grant)' },
    scope: 'all',
    level: 'default',
    handler: async ([arg0, options, description], ctx) => {
      // 兼容旧签名：首参非数组时视为 options（纯选择，不授权）。
      const legacy = !Array.isArray(arg0)
      const perms = legacy ? [] : (arg0 as string[])
      const opts = (legacy ? arg0 : options ?? {}) as Electron.OpenDialogOptions
      const desc = typeof description === 'string' && description.trim() ? description.trim() : undefined
      const result = await dialog.showOpenDialog(opts)
      const filePaths = result.filePaths ?? []
      if (result.canceled || filePaths.length === 0) {
        throw new DlientError(DlientErrorCode.DIALOG_CANCELED, 'dialog canceled')
      }
      // F1：返回路径统一 realpath 解析（含符号链接父目录），保证授权落库 key 与后续 fs.* 校验路径一致
      const resolvedPaths = await Promise.all(filePaths.map((p) => resolveRealSafe(p)))
      // permissions 为空（纯选择）→ 跳过授权与确认
      if (perms.length === 0) return { filePaths: resolvedPaths, granted: { read: [], write: [] } }
      const auth = await authorizeFsAccess(ctx.pluginId, resolvedPaths, perms, desc)
      if (!auth.ok) throw new DlientError(DlientErrorCode.USER_DENIED, 'user denied file access')
      const granted: { read: string[]; write: string[] } = { read: [], write: [] }
      if (perms.includes('fs.read')) granted.read = resolvedPaths
      if (perms.includes('fs.write')) granted.write = resolvedPaths
      return { filePaths: resolvedPaths, granted }
    },
  },
  {
    key: 'dialog.showSaveDialog',
    description: { 'zh-CN': '另存为对话框', 'en-US': 'Save dialog' },
    scope: 'all',
    level: 'default',
    handler: async ([options], ctx) => {
      // 主动保存：不弹确认框（意图明确）→ 写 temp-grant（save 场景专用）
      const opts = (options ?? {}) as Electron.SaveDialogOptions
      const result = await dialog.showSaveDialog(opts)
      if (result.canceled || !result.filePath) {
        throw new DlientError(DlientErrorCode.DIALOG_CANCELED, 'dialog canceled')
      }
      // F2：返回与授权均用 realpath 解析后路径，确保 temp-grant key 与后续 fs.write 的校验路径一致（含符号链接父目录场景）
      const filePath = await resolveRealSafe(result.filePath)
      getGrantHooks()?.resourceGrants.fs.grantTemp(ctx.pluginId, filePath, { mode: 'write' })
      return { filePath }
    },
  },
]
