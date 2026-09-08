/**
 * 宿主壳（App.tsx，开源版）：直接渲染内置操作台（layout 已并入宿主）。
 * 无核心插件下载/安装：启动即渲染主界面；插件清单 / 窗口控制等能力由 layout
 * 经 window.dlient.hostShell 首方通道获取。
 */

import LayoutApp from './layout/App'

export default function App() {
  return <LayoutApp />
}
