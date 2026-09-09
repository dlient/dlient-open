/**
 * @dlient-open/api-types — host-api 共享单源类型（docs/README 见本目录）。
 *
 * worker（@dlient-open/plugin-sdk rpc.xx）与 UI（@dlient-open/api-bridge api.xx）两端引用同一套
 * 方法签名 / options / 返回类型与英文说明，避免双份漂移。真源：app/src/main/api/*.ts。
 * 本文件仅做汇总：新增 host-api 方法时在 modules/<module>.ts 增补，并确认模块已在此 re-export。
 */

// 方法签名扁平表（key = 完整点路径）；先 import 供 HostApiMap 本地引用，再经 export type * 对外透出
import type { AppModuleApi } from './modules/app'
import type { I18nModuleApi } from './modules/i18n'
import type { OsModuleApi } from './modules/os'
import type { SystemModuleApi } from './modules/system'
import type { PowerSaveModuleApi } from './modules/powerSave'
import type { ScreenModuleApi } from './modules/screen'
import type { FsModuleApi } from './modules/fs'
import type { DialogModuleApi } from './modules/dialog'
import type { ClipboardModuleApi } from './modules/clipboard'
import type { NetModuleApi } from './modules/net'
import type { NotificationModuleApi } from './modules/notification'
import type { ChildModuleApi } from './modules/child'
import type { PermissionModuleApi } from './modules/permission'
import type { PluginModuleApi } from './modules/plugin'
import type { WebviewModuleApi } from './modules/webview'
import type { LogModuleApi } from './modules/log'
import type { NodejsModuleApi } from './modules/nodejs'

// 各模块 options / result 等具名类型（含各 <Cap>ModuleApi）
export type * from './modules/app'
export type * from './modules/i18n'
export type * from './modules/os'
export type * from './modules/system'
export type * from './modules/powerSave'
export type * from './modules/screen'
export type * from './modules/fs'
export type * from './modules/dialog'
export type * from './modules/clipboard'
export type * from './modules/net'
export type * from './modules/notification'
export type * from './modules/child'
export type * from './modules/permission'
export type * from './modules/plugin'
export type * from './modules/webview'
export type * from './modules/nodejs'

/**
 * 全部 host-api 方法的统一签名表（扁平，key = 点路径）。
 * worker 端以它为 rpc 模块树的类型基础；UI 端引用其中开放子集。
 */
export type HostApiMap = AppModuleApi &
  I18nModuleApi &
  OsModuleApi &
  SystemModuleApi &
  PowerSaveModuleApi &
  ScreenModuleApi &
  FsModuleApi &
  DialogModuleApi &
  ClipboardModuleApi &
  NetModuleApi &
  NotificationModuleApi &
  ChildModuleApi &
  PermissionModuleApi &
  PluginModuleApi &
  WebviewModuleApi &
  LogModuleApi &
  NodejsModuleApi
