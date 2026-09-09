import { createPluginViteConfig } from '@dlient-open/plugin-sdk/vite-config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 插件 UI 构建预设（System.register 格式，宿主用 SystemJS 加载，见 @dlient-open/ui PluginView）。
// - 构建：入口固定 remoteEntry.js，react 系与 @dlient-open/* 全部 external（宿主 SystemJS registry 单实例）；
//   CSS 合并单文件并由 dlient:css-link 注入 <link>（dlientV3:// 协议 + 版本戳）。
// - dev 模式（DLIENT_DEV=1）：预设读取 package.json 的 dlient.devPort 启动该插件独立的
//   vite dev server（react-refresh + HMR），宿主 PluginView 经 dlient.devServerUrl 加载。
const pluginId = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')).dlient?.id ?? 'unknown'
export default createPluginViteConfig({
  pluginId,
  pluginDir: fileURLToPath(new URL('.', import.meta.url)),
  hasWorker: true,
})
