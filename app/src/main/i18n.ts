/**
 * 主进程 i18n（main-process i18n.ts）：语言状态 + 主进程文案解析。
 *
 * 语言真源与同步（供主进程与插件 worker 使用，渲染层走既有 LANGUAGE 广播 → @dlient-open/i18n store）：
 *  - 初始：系统 locale（app.getLocale，zh* → 'zh-CN'，其余 → 'en-US'）；
 *  - 变更：plugin-setting 保存语言 → app.event(['language', value]) → 宿主广播前同步缓存（setMainLocale）；
 *  - 查询：worker 经 host-api `i18n.getLocale` 查询；主进程直接 getMainLocale()。
 *
 * 主进程/worker 面向用户的文案统一经 mt(key, params) 按当前语言返回，禁止硬编码单一语言。
 */

import { app } from 'electron'

export type MainLocale = 'zh-CN' | 'en-US'

let currentLocale: MainLocale = 'zh-CN'

/** 由系统 locale 推导应用语言（zh 前缀 → zh-CN，其余 → en-US） */
export function detectSystemLocale(): MainLocale {
  try {
    const loc = String(app.getLocale() ?? '').toLowerCase()
    return loc.startsWith('zh') ? 'zh-CN' : 'en-US'
  } catch {
    return 'zh-CN'
  }
}

/** 主进程装配时初始化（app ready 后调用；此时 app.getLocale 可用） */
export function initMainI18n(): void {
  currentLocale = detectSystemLocale()
}

/** 宿主广播 language 时同步缓存（值与 plugin-setting 落盘的设置一致） */
export function setMainLocale(value: unknown): void {
  currentLocale = value === 'zh-CN' || value === 'en-US' ? value : detectSystemLocale()
}

/** 当前语言（worker 查询 host-api i18n.getLocale 取该值） */
export function getMainLocale(): MainLocale {
  return currentLocale
}

type MessageParams = Record<string, string | number>
type MessageEntry = string | ((params?: MessageParams) => string)

/** 主进程文案字典（zh-CN / en-US；缺失回退中文再回退 key） */
const MESSAGES: Record<MainLocale, Record<string, MessageEntry>> = {
  'zh-CN': {
    // runtime-confirm 原生兜底框（无渲染层委托时的防御路径）
    'runtime.confirm.title': '插件权限请求',
    'runtime.confirm.line.fromTo': '插件「{from}」→「{target}」',
    'runtime.confirm.message.multi': '以下插件能力请求授权：',
    'runtime.confirm.message.single': '插件「{from}」需要调用插件「{target}」',
    'runtime.confirm.hint': '授权后 1 天内不再提示。',
    'runtime.confirm.allow': '允许',
    'runtime.confirm.deny': '拒绝',
    'runtime.confirm.logAccess.desc': '读取该插件的运行时日志（实时推送 / 历史 / 清空 / 下载）',
    // 授权弹框资源方法文本（export.ts confirmResource items.method）
    'resource.fs.readwrite': '读取 / 写入',
    'resource.fs.read': '读取',
    'resource.fs.write': '写入',
    'resource.net': '访问网络地址',
    'resource.spawn': '运行命令',
    // 授权弹框操作类别（kind 前缀：文件操作：读取 / 写入、网络请求、命令执行、跨插件调用）
    'resource.category.fs': '文件操作',
    'resource.category.net': '网络请求',
    'resource.category.spawn': '命令执行',
    'resource.category.log': '日志访问',
    'resource.category.call': '跨插件调用',
    // dev 插件目录选择原生框（plugins.dev.selectDirectory）
    'dialog.selectDevDir.title': '选择插件目录',
    'dialog.selectDevDir.button': '添加',
    // 快捷键注册失败（可能被系统或其他应用占用）
    'shortcut.registerBusy': 'shortcut register failed: {acc}（可能已被系统或其他应用占用）',
    // 启动引导离线兜底（核心插件缺失）
    'bootstrap.missingList': '缺失核心插件：{list}',
  },
  'en-US': {
    'runtime.confirm.title': 'Plugin permission request',
    'runtime.confirm.line.fromTo': 'Plugin "{from}" → "{target}"',
    'runtime.confirm.message.multi': 'The following plugin capabilities request authorization:',
    'runtime.confirm.message.single': 'Plugin "{from}" wants to call plugin "{target}"',
    'runtime.confirm.hint': 'Authorization lasts for 1 day.',
    'runtime.confirm.allow': 'Allow',
    'runtime.confirm.deny': 'Deny',
    'runtime.confirm.logAccess.desc': 'Read this plugin\u2019s runtime logs (live feed / history / clear / download)',
    'resource.fs.readwrite': 'Read / Write',
    'resource.fs.read': 'Read',
    'resource.fs.write': 'Write',
    'resource.net': 'Access network URL',
    'resource.spawn': 'Run command',
    // 授权弹框操作类别（kind 前缀：File operation: Read / Write、Network request、Command execution、Cross-plugin call）
    'resource.category.fs': 'File operation',
    'resource.category.net': 'Network request',
    'resource.category.spawn': 'Command execution',
    'resource.category.log': 'Log access',
    'resource.category.call': 'Cross-plugin call',
    'dialog.selectDevDir.title': 'Select plugin directory',
    'dialog.selectDevDir.button': 'Add',
    'shortcut.registerBusy': 'shortcut register failed: {acc} (may be in use by the system or another app)',
    'bootstrap.missingList': 'Missing core plugins: {list}',
  },
}

/** {{key}} 插值 */
function interpolate(text: string, params?: MessageParams): string {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(params[k] ?? `{{${k}}}`))
}

/** 按当前语言取主进程文案（支持 {key} 插值参数） */
export function mt(key: string, params?: MessageParams): string {
  let entry = MESSAGES[currentLocale][key] ?? MESSAGES['zh-CN'][key]
  if (entry == null) return key
  if (typeof entry === 'function') return interpolate(entry(params), params)
  return interpolate(entry, params)
}
