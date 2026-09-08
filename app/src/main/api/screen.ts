/**
 * api/screen.ts - screen 模块 host-api（只读；scope=worker）。
 */
import { screen } from 'electron'
import type { ApiDefinition } from './types'

export const screenApis: ApiDefinition[] = [
  {
    key: 'screen.getCursorScreenPoint',
    description: { 'zh-CN': '光标所在屏幕坐标', 'en-US': 'Cursor screen point' },
    scope: 'worker',
    level: 'default',
    handler: () => screen.getCursorScreenPoint(),
  },
  {
    key: 'screen.getPrimaryDisplay',
    description: { 'zh-CN': '主显示器信息', 'en-US': 'Primary display info' },
    scope: 'worker',
    level: 'default',
    handler: () => screen.getPrimaryDisplay(),
  },
  {
    key: 'screen.getAllDisplays',
    description: { 'zh-CN': '全部显示器信息', 'en-US': 'All displays info' },
    scope: 'worker',
    level: 'default',
    handler: () => screen.getAllDisplays(),
  },
  {
    key: 'screen.getDisplayNearestPoint',
    description: { 'zh-CN': '距坐标最近的显示器', 'en-US': 'Display nearest a point' },
    scope: 'worker',
    level: 'default',
    handler: ([point]) => screen.getDisplayNearestPoint(point as Electron.Point),
  },
  {
    key: 'screen.getDisplayMatching',
    description: { 'zh-CN': '与矩形相交最多的显示器', 'en-US': 'Display matching a rect' },
    scope: 'worker',
    level: 'default',
    handler: ([rect]) => screen.getDisplayMatching(rect as Electron.Rectangle),
  },
  {
    key: 'screen.screenToDipPoint',
    description: { 'zh-CN': '屏幕坐标转 DIP 坐标', 'en-US': 'Screen point to DIP point' },
    scope: 'worker',
    level: 'default',
    handler: ([point]) => screen.screenToDipPoint(point as Electron.Point),
  },
  {
    key: 'screen.dipToScreenPoint',
    description: { 'zh-CN': 'DIP 坐标转屏幕坐标', 'en-US': 'DIP point to screen point' },
    scope: 'worker',
    level: 'default',
    handler: ([point]) => screen.dipToScreenPoint(point as Electron.Point),
  },
  {
    key: 'screen.screenToDipRect',
    description: { 'zh-CN': '屏幕矩形转 DIP 矩形', 'en-US': 'Screen rect to DIP rect' },
    scope: 'worker',
    level: 'default',
    handler: ([, rect]) => screen.screenToDipRect(null, rect as Electron.Rectangle),
  },
  {
    key: 'screen.dipToScreenRect',
    description: { 'zh-CN': 'DIP 矩形转屏幕矩形', 'en-US': 'DIP rect to screen rect' },
    scope: 'worker',
    level: 'default',
    handler: ([, rect]) => screen.dipToScreenRect(null, rect as Electron.Rectangle),
  },
]
