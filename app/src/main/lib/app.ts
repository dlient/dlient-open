/**
 * lib/app.ts - app 模块复杂实现（方案 v2：窗口控制 / 原生菜单 / 插件数据路径下沉 lib；api/app.ts 引用）。
 * 无头模式自绘标题栏：插件经 app.window.* 控制主窗口（windowController 由宿主装配注入）；
 * 原生右键菜单仅放行安全字段；插件数据路径解析保证隔离（不可穿越）。
 */
import { BrowserWindow, Menu } from 'electron'
import { app } from 'electron'
import { join, normalize, sep } from 'node:path'
import { DlientError, DlientErrorCode } from '@dlient-open/core'

/** 主窗口控制器（由主进程装配注册，无头模式自绘标题栏需要操作窗口） */
export interface WindowController {
  close: () => void
  focus: () => void
  blur: () => void
  show: () => void
  hide: () => void
  maximize: () => void
  unmaximize: () => void
  minimize: () => void
  restore: () => void
  setFullScreen: (flag: boolean) => void
  /** 当前是否最大化（自绘标题栏切换 最大化/还原 图标） */
  isMaximized: () => boolean
  /** 主窗口实例（原生菜单 Menu.popup 需要挂载窗口） */
  getWindow: () => BrowserWindow | null
}

let windowController: WindowController | null = null

export function registerWindowController(controller: WindowController): void {
  windowController = controller
}

export function getWindowController(): WindowController | null {
  return windowController
}

/** 插件侧传入的原生菜单项模板（仅放行安全字段，不接受 electron 原生 role/click） */
interface NativeMenuItemSpec {
  /** 点击后回传的标识；separator 类型可省略 */
  id?: string
  label?: string
  type?: 'normal' | 'separator' | 'checkbox'
  enabled?: boolean
  checked?: boolean
}

/**
 * 弹出系统原生右键菜单：插件传菜单项模板 → 主进程构建 Menu → 弹出并等待用户选择。
 * 返回被点击项的 id（点击空白处/ESC 关闭返回 null）。
 * 只放行 label/type/enabled/checked 字段，click 由主进程注入，插件无法传入可执行代码。
 */
export async function popupNativeMenu(opts: unknown): Promise<string | null> {
  const { items, x, y } = (typeof opts === 'object' && opts !== null ? opts : {}) as {
    items?: unknown
    x?: number
    y?: number
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new DlientError(DlientErrorCode.INVALID, 'app.menu.popup requires { items: [...] }')
  }
  const win = getWindowController()?.getWindow() ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) throw new DlientError(DlientErrorCode.INTERNAL, 'app.menu.popup: no available window')

  return await new Promise<string | null>((resolve) => {
    let picked: string | null = null
    const template = (items as NativeMenuItemSpec[]).map((item) => {
      const spec = (typeof item === 'object' && item !== null ? item : {}) as NativeMenuItemSpec
      if (spec.type === 'separator') return { type: 'separator' as const }
      const id = spec.id == null ? '' : String(spec.id)
      return {
        label: String(spec.label ?? ''),
        type: spec.type === 'checkbox' ? ('checkbox' as const) : ('normal' as const),
        enabled: spec.enabled !== false,
        checked: spec.checked === true,
        click: () => {
          picked = id
        },
      }
    })
    const menu = Menu.buildFromTemplate(template)
    // closed 在 click 之后触发，此时 picked 已被赋值
    menu.popup({
      window: win,
      ...(typeof x === 'number' && typeof y === 'number' ? { x: Math.round(x), y: Math.round(y) } : {}),
      callback: () => resolve(picked),
    })
  })
}

/** 解析插件数据文件路径：只允许 <userData>/plugin-data/<pluginId>/<file>.json，禁止穿越 */
export function pluginDataFilePath(pluginId: string, file: unknown): string {
  const fileName = String(file ?? '').trim()
  if (!fileName || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    throw new DlientError(DlientErrorCode.INVALID, `invalid plugin data file: ${fileName}`)
  }
  const root = normalize(join(app.getPath('userData'), 'plugin-data', pluginId))
  const target = normalize(join(root, fileName))
  if (target !== root && !target.startsWith(root + sep)) {
    throw new DlientError(DlientErrorCode.INVALID, 'path traversal blocked')
  }
  return target
}
